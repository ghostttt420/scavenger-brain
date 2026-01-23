import os
os.environ["SDL_VIDEODRIVER"] = "dummy"
os.environ["SDL_AUDIODRIVER"] = "dummy"

import sys
import glob
import pickle
import imageio
import numpy as np
import neat
import pygame
import json
import random
import simulation 

# CONFIG
# We run 20 NEW generations every day. 
# If yesterday ended at Gen 50, today goes to Gen 70.
DAILY_GENERATIONS = 20  
VIDEO_OUTPUT_DIR = "training_clips"
FPS = 30 
MAX_FRAMES_PRO = 1800 # 60s for final
MAX_FRAMES_TRAINING = 450 # 15s for training clips

if not os.path.exists(VIDEO_OUTPUT_DIR): os.makedirs(VIDEO_OUTPUT_DIR)

try:
    with open("theme.json", "r") as f:
        THEME = json.load(f)
except:
    THEME = {"map_seed": 42}

def create_config_file():
    # --- STABILIZED LEGACY CONFIG ---
    config_content = """
[NEAT]
fitness_criterion     = max
fitness_threshold     = 100000
pop_size              = 40
reset_on_extinction   = False
no_fitness_termination = False

[DefaultGenome]
activation_default      = tanh
activation_mutate_rate  = 0.0
activation_options      = tanh
aggregation_default     = sum
aggregation_mutate_rate = 0.0
aggregation_options     = sum

# Moderate mutation rates for steady long-term learning
bias_init_mean          = 0.0
bias_init_stdev         = 1.0
bias_max_value          = 30.0
bias_min_value          = -30.0
bias_mutate_power       = 0.5
bias_replace_rate       = 0.1
bias_mutate_rate        = 0.2
bias_init_type          = gaussian

response_init_mean      = 1.0
response_init_stdev     = 0.0
response_max_value      = 30.0
response_min_value      = -30.0
response_mutate_power   = 0.0
response_replace_rate   = 0.0
response_mutate_rate    = 0.0
response_init_type      = gaussian

weight_init_mean        = 0.0
weight_init_stdev       = 1.0
weight_max_value        = 30
weight_min_value        = -30
weight_mutate_power     = 0.5
weight_replace_rate     = 0.1
weight_mutate_rate      = 0.3
weight_init_type        = gaussian

conn_add_prob           = 0.3
conn_delete_prob        = 0.3
enabled_default         = True
enabled_mutate_rate     = 0.01
feed_forward            = True
initial_connection      = full

enabled_rate_to_true_add = 0.0
enabled_rate_to_false_add = 0.0

num_hidden              = 0
num_inputs              = 7 
num_outputs             = 2

node_add_prob           = 0.1
node_delete_prob        = 0.1

compatibility_disjoint_coefficient = 1.0
compatibility_weight_coefficient   = 0.5

single_structural_mutation = False
structural_mutation_surer  = default

[DefaultSpeciesSet]
compatibility_threshold = 3.0

[DefaultStagnation]
species_fitness_func = max
max_stagnation       = 20
species_elitism      = 2

[DefaultReproduction]
elitism            = 2
survival_threshold = 0.2
min_species_size   = 2
    """
    with open("config.txt", "w") as f:
        f.write(config_content)

def run_dummy_generation():
    # Only run this if we are starting from SCRATCH (Gen 0)
    # Otherwise we skip it to save time
    checkpoints = glob.glob("neat-checkpoint-*")
    if len(checkpoints) > 0:
        return

    print("\n--- 🤡 Running Dummy Gen 0 (Fresh Start) ---")
    pygame.init()
    screen = pygame.display.set_mode((simulation.WIDTH, simulation.HEIGHT))

    map_gen = simulation.TrackGenerator(seed=THEME["map_seed"])
    start_pos, track_surface, visual_map, checkpoints, start_angle = map_gen.generate_track()
    map_mask = pygame.mask.from_surface(track_surface)
    camera = simulation.Camera(simulation.WORLD_SIZE, simulation.WORLD_SIZE)

    cars = [simulation.Car(start_pos, start_angle) for _ in range(40)]

    video_path = os.path.join(VIDEO_OUTPUT_DIR, "gen_00000.mp4")
    writer = imageio.get_writer(video_path, fps=FPS)

    running = True
    frame_count = 0
    while running and len(cars) > 0:
        frame_count += 1
        if frame_count > 300: break 
        for event in pygame.event.get():
            if event.type == pygame.QUIT: sys.exit()
        alive_cars = [c for c in cars if c.alive]
        if not alive_cars: break
        leader = max(alive_cars, key=lambda c: c.distance_traveled)
        camera.update(leader)
        for c in cars: c.is_leader = (c == leader)
        for car in cars:
            if not car.alive: continue
            if random.random() < 0.1: car.steering = random.choice([-1, 0, 1])
            car.input_gas()
            car.update(map_mask)
        screen.fill(simulation.COL_BG)
        screen.blit(visual_map, (camera.camera.x, camera.camera.y))
        for car in cars: car.draw(screen, camera)
        font = pygame.font.SysFont("consolas", 40, bold=True)
        screen.blit(font.render("GEN 0 (NOOB)", True, simulation.COL_WALL), (20, 20))
        pygame.display.flip()
        try:
            pixels = pygame.surfarray.array3d(screen)
            pixels = np.transpose(pixels, (1, 0, 2))
            writer.append_data(pixels)
        except: pass
    writer.close()
    print("✅ Gen 0 Saved.")

# Global to track start/end for this session
START_GEN = 0
FINAL_GEN = 0

def run_simulation(genomes, config):
    global GENERATION
    GENERATION += 1 # This will keep counting up (51, 52, 53...)
    print(f"\n--- 🏁 Gen {GENERATION} ---")

    nets = []
    cars = []
    ge = []

    pygame.init()
    screen = pygame.display.set_mode((simulation.WIDTH, simulation.HEIGHT))

    map_gen = simulation.TrackGenerator(seed=THEME["map_seed"])
    start_pos, track_surface, visual_map, checkpoints, start_angle = map_gen.generate_track()
    map_mask = pygame.mask.from_surface(track_surface)
    camera = simulation.Camera(simulation.WORLD_SIZE, simulation.WORLD_SIZE)

    for _, g in genomes:
        net = neat.nn.FeedForwardNetwork.create(g, config)
        nets.append(net)
        cars.append(simulation.Car(start_pos, start_angle)) 
        g.fitness = 0
        ge.append(g)

    writer = None

    # RECORDING LOGIC:
    # 1. Always record the VERY FIRST generation of the day (The "Fish out of Water")
    # 2. Record every 10th milestone
    # 3. Always record the LAST generation of the day

    is_first_of_day = (GENERATION == START_GEN + 1)
    is_milestone = (GENERATION % 10 == 0)
    is_last_of_day = (GENERATION >= FINAL_GEN)

    should_record = is_first_of_day or is_milestone or is_last_of_day

    if should_record:
        # Padded filename so they sort correctly (gen_00050.mp4)
        filename = f"gen_{GENERATION:05d}.mp4"
        video_path = os.path.join(VIDEO_OUTPUT_DIR, filename)
        print(f"🎥 Recording Gen {GENERATION}...")
        writer = imageio.get_writer(video_path, fps=FPS)

    running = True
    frame_count = 0
    for car in cars: car.check_radar(map_mask)

    # Give the "Pro" run (Last of day) full time (60s), others 15s
    current_max_frames = MAX_FRAMES_PRO if is_last_of_day else MAX_FRAMES_TRAINING

    while running and len(cars) > 0:
        frame_count += 1
        if frame_count > current_max_frames: break

        for event in pygame.event.get():
            if event.type == pygame.QUIT: sys.exit()

        leader = max(cars, key=lambda c: c.gates_passed * 1000 + c.distance_traveled)
        camera.update(leader)
        for c in cars: c.is_leader = (c == leader)

        for i, car in enumerate(cars):
            if not car.alive: continue

            if len(car.radars) < 5: inputs = [0] * 5
            else: inputs = [d[1] / simulation.SENSOR_LENGTH for d in car.radars]
            gps = car.get_data(checkpoints)
            inputs.extend(gps)

            output = nets[i].activate(inputs)
            if output[0] > 0.5: car.input_steer(right=True)
            elif output[0] < -0.5: car.input_steer(left=True)

            car.input_gas()
            car.update(map_mask)
            car.check_radar(map_mask)

            if car.check_gates(checkpoints):
                ge[i].fitness += 200

            dist_score = 1.0 - gps[1] 
            ge[i].fitness += dist_score * 0.05

            if not car.alive:
                 ge[i].fitness -= 50

            if not car.alive and car.frames_since_gate > 450:
                 ge[i].fitness -= 20

        for i in range(len(cars) - 1, -1, -1):
            if not cars[i].alive:
                cars.pop(i)
                nets.pop(i)
                ge.pop(i)

        if should_record or frame_count % 10 == 0:
            screen.fill(simulation.COL_BG)
            screen.blit(visual_map, (camera.camera.x, camera.camera.y))
            for car in cars: car.draw(screen, camera)

            font = pygame.font.SysFont("consolas", 40, bold=True)
            seconds = int(frame_count / FPS)
            screen.blit(font.render(f"{seconds}s", True, (255, 255, 255)), (20, 60))
            screen.blit(font.render(f"GEN {GENERATION}", True, simulation.COL_WALL), (20, 20))
            pygame.display.flip()

            if writer:
                try:
                    pixels = pygame.surfarray.array3d(screen)
                    pixels = np.transpose(pixels, (1, 0, 2))
                    writer.append_data(pixels)
                except: pass

    if writer: writer.close()

def run_neat(config_path):
    global GENERATION, START_GEN, FINAL_GEN

    # 1. Clear OLD clips (but NOT checkpoints)
    for f in glob.glob(os.path.join(VIDEO_OUTPUT_DIR, "*.mp4")):
        try: os.remove(f)
        except: pass

    # 2. Check for brain history
    checkpoints = [f for f in os.listdir(".") if f.startswith("neat-checkpoint-")]

    if checkpoints:
        # Load the smartest brain from yesterday
        latest = sorted(checkpoints, key=lambda x: int(x.split('-')[2]))[-1]
        print(f"🧠 RESTORING SUPER-BRAIN FROM: {latest}")

        # Parse Gen number (e.g. neat-checkpoint-50)
        START_GEN = int(latest.split('-')[2])
        GENERATION = START_GEN

        # Load it
        p = neat.Checkpointer.restore_checkpoint(latest)
    else:
        # First day ever
        print("👶 NO BRAIN FOUND. BIRTH OF A NEW SPECIES.")
        run_dummy_generation()
        START_GEN = 0
        GENERATION = 0
        config = neat.config.Config(neat.DefaultGenome, neat.DefaultReproduction,
                                    neat.DefaultSpeciesSet, neat.DefaultStagnation,
                                    config_path)
        p = neat.Population(config)

    # 3. Set Goals
    FINAL_GEN = START_GEN + DAILY_GENERATIONS
    print(f"🎯 MISSION: Evolve from Gen {START_GEN} -> Gen {FINAL_GEN}")

    # 4. Run
    p.add_reporter(neat.StdOutReporter(True))
    p.add_reporter(neat.Checkpointer(generation_interval=5, filename_prefix="neat-checkpoint-"))

    # neat-python's run() takes the *number of generations to run*, not the target ID
    p.run(run_simulation, DAILY_GENERATIONS)

if __name__ == "__main__":
    create_config_file()
    local_dir = os.path.dirname(__file__)
    config_path = os.path.join(local_dir, "config.txt")
    run_neat(config_path)