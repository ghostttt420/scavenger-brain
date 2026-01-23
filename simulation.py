import pygame
import math
import os
import random 
import numpy as np
from collections import deque
from scipy.interpolate import splprep, splev

# --- THEME ---
# High contrast for the AI (Black/White physics), Pretty for us
THEME = {"bg": (30,35,40), "road": (50,50,55), "wall": (200,20,20), "wall_alt": (220,220,220)}

WIDTH, HEIGHT = 1080, 1920
WORLD_SIZE = 4000
SENSOR_LENGTH = 300

def load_sprite(filename, scale_size=None):
    path = os.path.join("assets", filename)
    if os.path.exists(path):
        try:
            img = pygame.image.load(path).convert_alpha()
            if scale_size: img = pygame.transform.scale(img, scale_size)
            return img
        except: pass
    # Fallback
    surf = pygame.Surface(scale_size if scale_size else (40,60), pygame.SRCALPHA)
    pygame.draw.rect(surf, (0,0,255), (0,0,*scale_size))
    return surf

class Car:
    def __init__(self, start_pos, start_angle):
        self.position = pygame.math.Vector2(start_pos)
        self.velocity = pygame.math.Vector2(0, 0)
        self.angle = start_angle 
        self.acceleration = 0.0
        self.steering = 0.0
        self.speed = 0.0
        self.max_speed = 30      
        self.friction = 0.96 
        self.turn_speed = 0.2
        self.alive = True
        self.distance_traveled = 0 
        self.gates_passed = 0
        self.next_gate_idx = 0
        self.frames_since_gate = 0
        self.radars = [] 
        
        # VISUALS
        self.particles = [] 
        self.sprite_normal = load_sprite("car_normal.png", (50, 85))
        self.sprite_leader = load_sprite("car_leader.png", (50, 85))
        self.is_leader = False

    def input_steer(self, left=False, right=False):
        if left: self.steering = -1
        if right: self.steering = 1
    def input_gas(self): self.acceleration = 1.0

    def check_gates(self, checkpoints):
        if not self.alive: return False
        t_pos = pygame.math.Vector2(checkpoints[self.next_gate_idx % len(checkpoints)])
        if self.position.distance_to(t_pos) < 250:
            self.gates_passed += 1
            self.next_gate_idx += 1
            self.frames_since_gate = 0 
            return True
        return False

    def update(self, map_mask, skid_surface=None):
        if not self.alive: return
        self.frames_since_gate += 1
        if self.frames_since_gate > 90: 
            self.alive = False
            return

        self.velocity *= self.friction
        rad = math.radians(self.angle)
        self.velocity += pygame.math.Vector2(math.cos(rad), math.sin(rad)) * self.acceleration
        self.speed = self.velocity.length()
        if self.speed > self.max_speed: self.velocity.scale_to_length(self.max_speed)
        
        if self.speed > 2:
            self.angle += self.steering * self.speed * self.turn_speed
            
            # DRIFT VISUALS (Only if skid_surface is provided)
            if skid_surface and abs(self.steering) > 0.8 and self.speed > 15:
                # Tire Tracks
                offset_L = pygame.math.Vector2(-20, -15).rotate(self.angle)
                offset_R = pygame.math.Vector2(-20, 15).rotate(self.angle)
                pygame.draw.circle(skid_surface, (20,20,20), (int(self.position.x+offset_L.x), int(self.position.y+offset_L.y)), 4)
                pygame.draw.circle(skid_surface, (20,20,20), (int(self.position.x+offset_R.x), int(self.position.y+offset_R.y)), 4)
                # Smoke
                if random.random() < 0.3:
                    self.particles.append([self.position + offset_L, random.randint(10, 20), random.randint(5, 12)])

        self.position += self.velocity
        self.distance_traveled += self.speed

        # COLLISION (Simple & Reliable)
        try:
            # Check center point
            if map_mask.get_at((int(self.position.x), int(self.position.y))) == 0:
                self.alive = False
        except: 
            self.alive = False 
        
        self.acceleration = 0
        self.steering = 0

    def check_radar(self, map_mask):
        self.radars.clear()
        for degree in [-60, -30, 0, 30, 60]:
            length = 0
            rad = math.radians(self.angle + degree)
            vec = pygame.math.Vector2(math.cos(rad), math.sin(rad))
            center = self.position
            while length < SENSOR_LENGTH:
                length += 20
                check = center + vec * length
                try:
                    if map_mask.get_at((int(check.x), int(check.y))) == 0: break
                except: break
                length += 1 # Safety step
            self.radars.append([(int(check.x), int(check.y)), length])

    def draw(self, screen, camera):
        if not self.alive: return
        
        # Smoke
        for i in range(len(self.particles)-1,-1,-1):
            pos,life,size = self.particles[i]
            life-=1
            self.particles[i][1]=life
            if life<=0: self.particles.pop(i)
            else:
                adj = camera.apply_point(pos)
                s = pygame.Surface((size*2,size*2), pygame.SRCALPHA)
                pygame.draw.circle(s, (200,200,200,int(life/20*100)), (size,size), size)
                screen.blit(s, (adj[0]-size, adj[1]-size))
        
        # F1 Car
        img = self.sprite_leader if self.is_leader else self.sprite_normal
        rot = pygame.transform.rotate(img, -self.angle - 90)
        rect = rot.get_rect(center=camera.apply_point(self.position))
        
        # Shadow
        shad = pygame.transform.rotate(img, -self.angle - 90)
        shad.fill((0,0,0,80), special_flags=pygame.BLEND_RGBA_MULT)
        screen.blit(shad, (rect.x+5, rect.y+5))
        
        screen.blit(rot, rect.topleft)

class Camera:
    def __init__(self, width, height):
        self.camera = pygame.Rect(0, 0, width, height)
        self.width = width
        self.height = height
        
    def apply_point(self, pos):
        return (int(pos[0] + self.camera.x), int(pos[1] + self.camera.y))

    def update(self, target):
        # SIMPLE LOGIC (Video 1 Style): Just center the target. No clamping. No Lerp.
        # This prevents it from getting "Stuck" on edges.
        x = -target.position.x + WIDTH / 2
        y = -target.position.y + HEIGHT / 2
        self.camera = pygame.Rect(int(x), int(y), self.width, self.height)

class TrackGenerator:
    def __init__(self, seed): np.random.seed(seed)
    def generate_track(self):
        phys_surf = pygame.Surface((WORLD_SIZE, WORLD_SIZE))
        vis_surf = pygame.Surface((WORLD_SIZE, WORLD_SIZE))
        skid_surf = pygame.Surface((WORLD_SIZE, WORLD_SIZE), pygame.SRCALPHA) # Added Layer
        
        phys_surf.fill((0,0,0)) 
        vis_surf.fill(THEME["bg"]) 

        # Track Generation
        points = []
        for i in range(20): 
            angle = (i/20) * 2 * math.pi
            r = np.random.randint(1100, 1800)
            points.append((WORLD_SIZE//2 + r*math.cos(angle), WORLD_SIZE//2 + r*math.sin(angle)))
        points.append(points[0]) 

        pts = np.array(points)
        tck, u = splprep(pts.T, u=None, s=0.0, per=1)
        u_new = np.linspace(u.min(), u.max(), 5000)
        x_new, y_new = splev(u_new, tck, der=0)
        smooth = list(zip(x_new, y_new))
        checkpoints = smooth[::70]

        # Physics (White road on Black bg)
        pygame.draw.lines(phys_surf, (255,255,255), True, smooth, 450)
        
        # Visuals
        for i, p in enumerate(smooth[::5]):
            c = THEME["wall"] if i%4 < 2 else THEME["wall_alt"]
            pygame.draw.circle(vis_surf, c, (int(p[0]), int(p[1])), 260)
        for p in smooth[::5]:
            pygame.draw.circle(vis_surf, THEME["road"], (int(p[0]), int(p[1])), 230)
        
        start_angle = math.degrees(math.atan2(y_new[5]-y_new[0], x_new[5]-x_new[0]))
        
        # RETURN 6 ITEMS (Brain needs to unpack 6)
        return (int(x_new[0]), int(y_new[0])), phys_surf, vis_surf, skid_surf, checkpoints, start_angle
