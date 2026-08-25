import subprocess
import os
import threading
import gradio as gr

def start_meshcentral():
    env = os.environ.copy()
    cmd = ["node", "start.js"]
    subprocess.run(cmd, env=env)

# הפעלת MeshCentral ברקע כ-Thread נפרד
t = threading.Thread(target=start_meshcentral, daemon=True)
t.start()

def status():
    return "SIONYX MeshCentral Server is running on Hugging Face Free Tier! 🚀"

demo = gr.Interface(
    fn=status, 
    inputs=[], 
    outputs="text", 
    title="SIONYX Remote Control - MeshCentral"
)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)