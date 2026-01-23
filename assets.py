import pygame
import os

ASSET_DIR = "assets"
if not os.path.exists(ASSET_DIR):
    os.makedirs(ASSET_DIR)

def create_f1_sprite(color, filename):
    """Generates a high-res F1 car sprite."""
    w, h = 60, 100 
    surf = pygame.Surface((w, h), pygame.SRCALPHA)
    body_col = color
    tire_col = (20, 20, 20)
    cockpit_col = (10, 10, 10)
    helmet_col = (255, 255, 0)
    wing_col = (50, 50, 50)

    # Shadow
    pygame.draw.ellipse(surf, (0, 0, 0, 60), (5, 5, w-10, h-10))

    # Rear Wing
    pygame.draw.rect(surf, wing_col, (5, 85, 50, 10))
    # Rear Tires
    pygame.draw.rect(surf, tire_col, (0, 60, 12, 25), border_radius=3)
    pygame.draw.rect(surf, tire_col, (48, 60, 12, 25), border_radius=3)
    # Body
    pygame.draw.polygon(surf, body_col, [(20, 10), (40, 10), (45, 60), (42, 90), (18, 90), (15, 60)])
    # Front Tires
    pygame.draw.rect(surf, tire_col, (0, 15, 10, 20), border_radius=3)
    pygame.draw.rect(surf, tire_col, (50, 15, 10, 20), border_radius=3)
    # Front Wing
    pygame.draw.polygon(surf, wing_col, [(5, 5), (55, 5), (30, 0)])
    # Cockpit
    pygame.draw.ellipse(surf, cockpit_col, (25, 45, 10, 20))
    pygame.draw.circle(surf, helmet_col, (30, 50), 4)

    pygame.image.save(surf, os.path.join(ASSET_DIR, filename))
    print(f"🎨 Generated asset: {filename}")

def generate_fx_assets():
    """Generates a soft alpha smoke puff."""
    surf = pygame.Surface((32, 32), pygame.SRCALPHA)
    # Soft radial gradient for smoke
    for i in range(16, 0, -1):
        alpha = int(100 * (i / 16)) 
        pygame.draw.circle(surf, (220, 220, 220, alpha), (16, 16), i)
    pygame.image.save(surf, os.path.join(ASSET_DIR, "particle_smoke.png"))
    print("✨ Generated FX: Smoke")

if __name__ == "__main__":
    pygame.init()
    create_f1_sprite((220, 0, 0), "car_leader.png") # Red
    create_f1_sprite((0, 0, 220), "car_normal.png") # Blue
    generate_fx_assets()
    print("✅ Assets Complete.")
