import pygame
import math
import os
import json
import random 
import numpy as np
from collections import deque
from scipy.interpolate import splprep, splev

# --- LOAD THEME (Modern Clean) ---
THEME = {
    "map_seed": 42,
    "physics": {"friction": 0.97},
    "visuals": {
        "bg": [20, 20, 25],          # Dark Slate
        "road": [40, 40, 45],        # Asphalt
        "wall": [200, 50, 50],       # Red (Kerb)
        "wall_alt": [200, 200, 200], # White (Kerb)
        "center": [255, 255, 255]    # White dashed line
    }
}

WIDTH, HEIGHT = 1080, 1920
WORLD_SIZE = 4000
SENSOR_LENGTH = 300

# --- COMPATIBILITY LAYER (THE FIX) ---
# We re-export these constants so brain.py can find them
COL_BG = THEME["visuals"]["bg"]
COL_WALL = THEME["visuals"]["wall"] 
COL_ROAD = THEME["visuals"]["road"]

def load_sprite(filename, scale_size=None):
    path = os.path.join("assets", filename)
    if not os.path.exists(path):
        surf = pygame.Surface(scale_size if scale_size else (40, 60), pygame.SRCALPHA)
        if "car" in filename:
            pygame.draw.rect(surf, (50, 150, 255), (0, 0, scale_size[0], scale_size[1]), border_radius=10)
            pygame.draw.rect(surf, (30, 100, 200), (5, 10, scale_size[0]-10, scale_size[1]-20), border_radius=5)
            pygame.draw.rect(surf, (20, 20, 30), (5, 5, scale_size[0]-10, 15), border_radius=3)
        elif "smoke" in filename:
            pygame.draw.circle(surf, (200, 200, 200, 100), (16, 16), 16)
        return surf
        
    img = pygame.image.load(path).convert_alpha()
    if scale_size:
        img = pygame.transform.scale(img, scale_size)
    return img

class Car:
    def __init__(self, start_pos, start_angle):
        self.position = pygame.math.Vector2(start_pos)
        self.velocity = pygame.math.Vector2(0, 0)
        self.angle = start_angle 
        self.acceleration = 0.0
        self.steering = 0.0
        self.max_speed = 29      
        self.friction = 0.97 
        self.acceleration_rate = 1.2
        self.turn_speed = 0.18   
        self.alive = True
        self.distance_traveled = 0 
        self.is_leader = False
        self.gates_passed = 0
        self.next_gate_idx = 0
        self.frames_since_gate = 0
        self.radars = [] 

        self.trail = deque(maxlen=40) 
        self.particles = []
        self.sprite = load_sprite("car_normal.png", (50, 85))
        self.rect = self.sprite.get_rect(center=self.position)

    def get_data(self, checkpoints):
        if not self.alive: return [0, 0]
        target_idx = self.next_gate_idx % len(checkpoints)
        target_pos = pygame.math.Vector2(checkpoints[target_idx])
        dx = target_pos.x - self.position.x
        dy = target_pos.y - self.position.y
        target_rad = math.atan2(dy, dx)
        car_rad = math.radians(self.angle)
        diff = target_rad - car_rad
        while diff > math.pi: diff -= 2 * math.pi
        while diff < -math.pi: diff += 2 * math.pi
        return [diff / math.pi, min(self.position.distance_to(target_pos) / 1000.0, 1.0)]

    def input_steer(self, left=False, right=False):
        if left: self.steering = -1
        if right: self.steering = 1

    def input_gas(self):
        self.acceleration = self.acceleration_rate

    def check_gates(self, checkpoints):
        if not self.alive: return False
        target_idx = self.next_gate_idx % len(checkpoints)
        target_pos = pygame.math.Vector2(checkpoints[target_idx])
        if self.position.distance_to(target_pos) < 300:
            self.gates_passed += 1
            self.next_gate_idx += 1
            self.frames_since_gate = 0 
            return True
        return False

    def update(self, map_mask):
        if not self.alive: return
        self.frames_since_gate += 1
        if self.frames_since_gate > 90:
            self.alive = False
            return

        self.velocity *= self.friction
        rad = math.radians(self.angle)
        self.velocity += pygame.math.Vector2(math.cos(rad), math.sin(rad)) * self.acceleration
        if self.velocity.length() > self.max_speed: self.velocity.scale_to_length(self.max_speed)
        
        if self.velocity.length() > 2:
            self.angle += self.steering * self.velocity.length() * self.turn_speed
            if abs(self.steering) > 0.5 and self.velocity.length() > 15:
                if random.random() < 0.3:
                    offset = pygame.math.Vector2(-20, 0).rotate(self.angle)
                    self.particles.append([self.position + offset, random.randint(15, 25), random.randint(10, 20)]) 

        self.position += self.velocity
        self.distance_traveled += self.velocity.length()
        self.rect.center = (int(self.position.x), int(self.position.y))
        
        if self.frames_since_gate % 2 == 0:
            self.trail.append(self.position.copy())

        try:
            if map_mask.get_at((int(self.position.x), int(self.position.y))) == 0:
                self.alive = False
        except: self.alive = False
        
        self.acceleration = 0
        self.steering = 0

    def check_radar(self, map_mask):
        self.radars.clear()
        for degree in [-60, -30, 0, 30, 60]:
            self.cast_ray(degree, map_mask)

    def cast_ray(self, degree, map_mask):
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
        self.radars.append([(int(check.x), int(check.y)), length])

    def draw(self, screen, camera):
        if not self.alive: return
        
        if len(self.trail) > 2:
            points = [camera.apply_point(p) for p in self.trail]
            if len(points) > 2:
                color = (0, 255, 65) if self.is_leader else (200, 200, 255)
                pygame.draw.lines(screen, color, False, points, 3)

        for i in range(len(self.particles)-1, -1, -1):
            pos, life, size = self.particles[i]
            life -= 1
            self.particles[i][1] = life
            if life <= 0: self.particles.pop(i)
            else:
                adj = camera.apply_point(pos)
                s = pygame.Surface((size*2, size*2), pygame.SRCALPHA)
                pygame.draw.circle(s, (255, 255, 255, int((life/25)*100)), (size, size), size)
                screen.blit(s, (adj[0]-size, adj[1]-size))

        img = self.sprite
        rotated_img = pygame.transform.rotate(img, -self.angle - 90)
        draw_pos = camera.apply_point(self.position)
        rect = rotated_img.get_rect(center=draw_pos)
        
        shadow_surf = pygame.transform.rotate(img, -self.angle - 90)
        shadow_surf.fill((0, 0, 0, 100), special_flags=pygame.BLEND_RGBA_MULT)
        screen.blit(shadow_surf, (rect.x + 5, rect.y + 5)) 
        
        screen.blit(rotated_img, rect.topleft)

class Camera:
    def __init__(self, width, height):
        self.camera = pygame.Rect(0, 0, width, height)
        self.width = width
        self.height = height
        self.exact_x = 0.0
        self.exact_y = 0.0

    def apply_point(self, pos):
        return (int(pos[0] + self.exact_x), int(pos[1] + self.exact_y))

    def update(self, target):
        target_x = -target.position.x + WIDTH / 2
        target_y = -target.position.y + HEIGHT / 2
        
        target_x = min(0, max(-(self.width - WIDTH), target_x))
        target_y = min(0, max(-(self.height - HEIGHT), target_y))

        self.exact_x += (target_x - self.exact_x) * 0.1
        self.exact_y += (target_y - self.exact_y) * 0.1
        
        self.camera = pygame.Rect(int(self.exact_x), int(self.exact_y), self.width, self.height)

class TrackGenerator:
    def __init__(self, seed):
        np.random.seed(seed)

    def generate_track(self):
        phys_surf = pygame.Surface((WORLD_SIZE, WORLD_SIZE))
        vis_surf = pygame.Surface((WORLD_SIZE, WORLD_SIZE))

        phys_surf.fill((0,0,0)) 
        vis_surf.fill(THEME["visuals"]["bg"]) 

        points = []
        for i in range(20):
            angle = (i / 20) * 2 * math.pi
            radius = np.random.randint(1100, 1800)
            points.append((WORLD_SIZE // 2 + radius * math.cos(angle), WORLD_SIZE // 2 + radius * math.sin(angle)))
        points.append(points[0]) 

        pts = np.array(points)
        tck, u = splprep(pts.T, u=None, s=0.0, per=1)
        u_new = np.linspace(u.min(), u.max(), 5000)
        x_new, y_new = splev(u_new, tck, der=0)
        smooth_points = list(zip(x_new, y_new))

        checkpoints = smooth_points[::70]

        pygame.draw.lines(phys_surf, (255, 255, 255), True, smooth_points, 450) 

        brush_points = smooth_points[::5] 

        for i, p in enumerate(brush_points):
            color = THEME["visuals"]["wall"] if i % 4 < 2 else THEME["visuals"]["wall_alt"]
            pygame.draw.circle(vis_surf, color, (int(p[0]), int(p[1])), 260)
        
        for p in brush_points:
            pygame.draw.circle(vis_surf, THEME["visuals"]["road"], (int(p[0]), int(p[1])), 230)
        
        for i in range(0, len(smooth_points), 40): 
            end = min(i+20, len(smooth_points)-1)
            segment = smooth_points[i:end]
            if len(segment) > 1:
                pygame.draw.lines(vis_surf, THEME["visuals"]["center"], False, segment, 4)

        return (int(x_new[0]), int(y_new[0])), phys_surf, vis_surf, checkpoints, math.degrees(math.atan2(y_new[5]-y_new[0], x_new[5]-x_new[0]))
