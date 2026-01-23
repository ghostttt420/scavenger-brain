import os
# Force software rendering to avoid "No Video Device" errors on servers
os.environ["SDL_VIDEODRIVER"] = "dummy"
os.environ["SDL_AUDIODRIVER"] = "dummy"

import PIL.Image
if not hasattr(PIL.Image, 'ANTIALIAS'):
    PIL.Image.ANTIALIAS = PIL.Image.LANCZOS

import random
import json
from moviepy.editor import VideoFileClip, TextClip, CompositeVideoClip, concatenate_videoclips, AudioFileClip, CompositeAudioClip, vfx
from moviepy.audio.fx.all import audio_loop

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# CONFIG
CLIPS_DIR = "training_clips"
OUTPUT_FILE = "evolution_35s.mp4"

# --- DJ SYSTEM ---
MUSIC_OPTIONS = ["music.mp3", "music2.mp3", "music3.mp3"] 

# --- VIRAL TITLE LIBRARY ---
VIRAL_TITLES = [
    "AI Learns to Drive: Gen 1 vs Gen {gen} 🤯",
    "I taught an AI to drive and it did THIS... (Gen {gen})",
    "Watch my AI go from NOOB to PRO in {gen} Gens 🚀",
    "Can AI beat a Pro Driver? Gen {gen} Update",
    "Evolution of AI Driving: Gen 0 to {gen}",
    "Satisfying AI Lines... Gen {gen} is CLEAN 🤤"
]

def get_viral_title(generation):
    template = random.choice(VIRAL_TITLES)
    return template.format(gen=generation)

def make_video():
    print("🎬 Starting 35s Strict-Edit...")

    if not os.path.exists(CLIPS_DIR):
        print(f"❌ Error: Directory '{CLIPS_DIR}' not found.")
        return None, 0

    files = [f for f in os.listdir(CLIPS_DIR) if f.endswith(".mp4")]
    if not files:
        print("❌ Error: No .mp4 files found.")
        return None, 0

    files.sort()
    
    # Strategy: 5s Hook + 25s Montage + 5s Payoff = 35s
    clips = []
    
    # 1. THE HOOK (Gen 0)
    hook_clip = VideoFileClip(os.path.join(CLIPS_DIR, files[0]))
    if hook_clip.duration > 5: hook_clip = hook_clip.subclip(0, 5)
    
    try:
        txt = TextClip("GEN 0: CHAOS 🤡", fontsize=80, color='white', font='DejaVu-Sans-Bold', stroke_color='black', stroke_width=3)
        txt = txt.set_position(('center', 0.8), relative=True).set_duration(hook_clip.duration)
        hook_clip = CompositeVideoClip([hook_clip, txt])
    except Exception as e: print(f"Text Error: {e}")
    clips.append(hook_clip)

    # 2. THE MONTAGE (Middle Gens)
    middle_files = files[1:-1]
    if len(middle_files) > 5:
        random.shuffle(middle_files)
        middle_files = middle_files[:5]
    middle_files.sort()
    
    for f in middle_files:
        c = VideoFileClip(os.path.join(CLIPS_DIR, f))
        if c.duration > 5: c = c.subclip(0, 5)
        
        gen_num = f.split('_')[1].split('.')[0]
        try:
            txt = TextClip(f"Gen {gen_num}", fontsize=60, color='yellow', font='DejaVu-Sans-Bold', stroke_color='black', stroke_width=2)
            txt = txt.set_position(('left', 'top')).set_duration(c.duration)
            c = CompositeVideoClip([c, txt])
        except: pass
        clips.append(c)

    # 3. THE PAYOFF (Final Gen)
    final_clip = VideoFileClip(os.path.join(CLIPS_DIR, files[-1]))
    last_gen_num = files[-1].split('_')[1].split('.')[0]
    if final_clip.duration > 5: final_clip = final_clip.subclip(0, 5)
    
    try:
        txt = TextClip("MASTERED IT 🚀", fontsize=80, color='#00ff41', font='DejaVu-Sans-Bold', stroke_color='black', stroke_width=3)
        txt = txt.set_position(('center', 'center')).set_duration(final_clip.duration)
        final_clip = CompositeVideoClip([final_clip, txt])
    except: pass
    clips.append(final_clip)

    # STITCH
    final_video = concatenate_videoclips(clips, method="compose")

    # STRICT TIMING CHECK (35.0s)
    current_duration = final_video.duration
    target_duration = 35.0
    
    if current_duration > 0:
        speed_factor = current_duration / target_duration
        print(f"⚡ Precision Retiming: {current_duration}s -> 35.0s (Speed: {speed_factor:.2f}x)")
        final_video = final_video.fx(vfx.speedx, speed_factor)
    
    # AUDIO (Loop music to exactly 35s)
    available_music = [m for m in MUSIC_OPTIONS if os.path.exists(m)]
    if available_music:
        chosen_song = random.choice(available_music)
        print(f"🎵 DJ Selected: {chosen_song}")
        music = AudioFileClip(chosen_song)
        music = audio_loop(music, duration=35.0)
        music = music.volumex(0.5)
        final_video = final_video.set_audio(music)

    final_video.write_videofile(OUTPUT_FILE, fps=30, codec='libx264', audio_codec='aac', preset='medium', logger=None)
    return OUTPUT_FILE, last_gen_num

def upload_video(filename, last_gen):
    print("🚀 Connecting to YouTube API...")
    try:
        creds = Credentials(None, refresh_token=os.environ["YT_REFRESH_TOKEN"], token_uri="https://oauth2.googleapis.com/token", client_id=os.environ["YT_CLIENT_ID"], client_secret=os.environ["YT_CLIENT_SECRET"])
        youtube = build("youtube", "v3", credentials=creds)

        title = get_viral_title(last_gen) + " #shorts"
        description = f"Gen {last_gen} of AI learning to drive. #ai #machinelearning #python"

        request = youtube.videos().insert(
            part="snippet,status",
            body={
                "snippet": {"title": title, "description": description, "tags": ["ai", "python"], "categoryId": "28"},
                "status": { "privacyStatus": "public" }
            },
            media_body=MediaFileUpload(filename)
        )
        response = request.execute()
        print(f"✅ Upload Complete! ID: {response['id']}")
    except Exception as e:
        print(f"❌ Upload Failed: {e}")

if __name__ == "__main__":
    # 1. Make the video locally
    output_path, generation_count = make_video()
    
    if output_path:
        print(f"✅ Video generated at: {output_path}")
        
        # 2. UPLOAD (Uncomment this line when you are ready to go live)
        # upload_video(output_path, generation_count)
