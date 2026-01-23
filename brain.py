import pygame
import neat
import os
import random
import pickle
import sys
import math
import simulation 
from moviepy.editor import ImageSequenceClip

# --- CONFIG ---
GENERATIONS = 20  
POPULATION = 30   
WIDTH, HEIGHT = 1080, 1920 

def run_simulation(genomes, config):
    pygame.init()
    # No window mode for server
    os.environ["SDL_VIDEODRIVER"] = "dummy"
    screen = pygame.display.set_mode((WIDTH, HEIGHT))
    
    # Generate Map
    track_gen = simulation.TrackGenerator(seed=42)
    start_pos, phys_map, vis_map, skid_map, checkpoints, start_angle = track_gen.generate_track()
    
    nets = []
    cars = []
    ge = []

    for _, g in genomes:
        net = neat.nn.FeedForwardNetwork.create(g, config)
        nets.append(net)
        cars.append(simulation.Car(start_pos, start_angle))
        g.fitness = 0
        ge.append(g)

    camera = simulation.Camera(simulation.WORLD_SIZE, simulation.WORLD_SIZE)
    clock = pygame.time.Clock()
    
    frames = []
    
    # 20 Seconds Max per Generation
    for frame_idx in range(600): 
        # Update Cars
        alive_count = 0
        best_car = None
        max_dist = 0

        for i, car in enumerate(cars):
            if car.alive:
                alive_count += 1
                
                # --- SMARTER AI INPUTS ---
                # Get data: [AngleDiff, DistToGate, Speed]
                input_data = car.get_data(checkpoints) 
                
                # Add Radars (5 sensors)
                car.check_radar(phys_map)
                radar_data = [r[1]/simulation.SENSOR_LENGTH for r in car.radars]
                
                # Total inputs = 3 + 5 = 8
                final_inputs = input_data + radar_data 
                
                output = nets[i].activate(final_inputs)
                
                # Activation
                if output[0] > 0.5: car.input_steer(right=True)
                if output[0] < -0.5: car.input_steer(left=True)
                if output[1] > 0.5: car.input_gas()
                
                # Update with SKID MAP
                car.update(phys_map, skid_map)
                
                # --- SMARTER REWARD SYSTEM ---
                # Reward 1: Distance traveled
                ge[i].fitness += car.speed * 0.1 
                
                # Reward 2: Passing Gates (Big Bonus)
                if car.check_gates(checkpoints):
                    ge[i].fitness += 50 
                
                if car.distance_traveled > max_dist:
                    max_dist = car.distance_traveled
                    best_car = car

        if alive_count == 0: break
        
        # Camera Follow Best
        if best_car:
            best_car.is_leader = True
            camera.update(best_car)
            for c in cars: 
                if c != best_car: c.is_leader = False

        # Draw Frame
        # 1. Background
        sub_rect = camera.camera
        try:
            # Optimize: Only blit visible area
            screen.fill(simulation.COL_BG)
            screen.blit(vis_map, (0,0), area=sub_rect) # Track
            screen.blit(skid_map, (0,0), area=sub_rect) # Skids
        except: pass 
        
        # 2. Cars
        for car in cars:
            car.draw(screen, camera)
            
        # 3. Capture
        if frame_idx % 2 == 0: # 30 FPS capture
            data = pygame.image.tostring(screen, 'RGB')
            frames.append(data)

    return frames, best_car.gates_passed if best_car else 0

def run_neat(config_file):
    config = neat.config.Config(neat.DefaultGenome, neat.DefaultReproduction,
                                neat.DefaultSpeciesSet, neat.DefaultStagnation,
                                config_file)
    
    p = neat.Population(config)
    
    # Hook for capturing specific generations
    training_data = [] # Stores (gen_num, frame_data)
    
    def eval_genomes(genomes, config):
        gen_num = p.generation
        print(f"🧬 Gen {gen_num}...")
        frames, score = run_simulation(genomes, config)
        
        # Capture logic: Gen 0, then every 5th, then last
        if gen_num == 0 or gen_num % 4 == 0 or gen_num >= GENERATIONS-1:
            # Save frames to folder
            clip_name = f"training_clips/gen_{gen_num}.mp4"
            print(f"💾 Saving Clip: {clip_name}")
            
            # Convert raw bytes to VideoClip
            def make_frame(t):
                idx = int(t * 30)
                if idx >= len(frames): idx = len(frames) - 1
                return pygame.image.fromstring(frames[idx], (WIDTH, HEIGHT), 'RGB')
            
            from moviepy.editor import VideoClip
            clip = VideoClip(make_frame, duration=len(frames)/30)
            clip.write_videofile(clip_name, fps=30, logger=None)

    # Create output dir
    if not os.path.exists("training_clips"): os.makedirs("training_clips")
    
    p.run(eval_genomes, GENERATIONS)

if __name__ == "__main__":
    # DYNAMIC CONFIG CREATION (To avoid file dependency issues)
    config_content = """
[NEAT]
fitness_criterion     = max
fitness_threshold     = 100000
pop_size              = 30
reset_on_extinction   = False
no_fitness_termination = False  

[DefaultGenome]
# Node activation options
activation_default    = tanh
activation_mutate_rate = 0.0
activation_options    = tanh

# Node aggregation options
aggregation_default   = sum
aggregation_mutate_rate = 0.0
aggregation_options   = sum

# Structural mutation
bias_init_mean        = 0.0
bias_init_stdev       = 1.0
bias_max_value        = 30.0
bias_min_value        = -30.0
bias_mutate_power     = 0.5
bias_mutate_rate      = 0.7
bias_replace_rate     = 0.1

# Connection mutation
conn_add_prob         = 0.5
conn_delete_prob      = 0.5
enabled_default       = True
enabled_mutate_rate   = 0.01

feed_forward          = True
initial_connection    = full

# Network parameters
# 5 Radars + Angle + Dist + Speed = 8 INPUTS
num_hidden            = 0
num_inputs            = 8
num_outputs           = 2

# Node parameters
response_init_mean    = 1.0
response_init_stdev   = 0.0
response_max_value    = 30.0
response_min_value    = -30.0
response_mutate_power = 0.0
response_mutate_rate  = 0.0
response_replace_rate = 0.0

# Weight mutation
weight_init_mean      = 0.0
weight_init_stdev     = 1.0
weight_max_value      = 30
weight_min_value      = -30
weight_mutate_power   = 0.5
weight_mutate_rate    = 0.8
weight_replace_rate   = 0.1

[DefaultSpeciesSet]
compatibility_threshold = 3.0

[DefaultStagnation]
species_fitness_func = max
max_stagnation       = 20
species_elapse_time  = 0

[DefaultReproduction]
elitism            = 2
survival_threshold = 0.2
    """
    with open("config-feedforward.txt", "w") as f:
        f.write(config_content)

    run_neat("config-feedforward.txt")
