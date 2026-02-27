import requests
import base64
import json

with open("../test thumbnails/Hungry worm dark GTA v.jpg", "rb") as f:
    b64 = base64.b64encode(f.read()).decode("utf-8")

res = requests.post("http://127.0.0.1:8000/embed", json={"image_b64": b64})
data = res.json()
print("DIM:", data.get("dim"))
global_v = data.get("global", [])
print("GLOBAL TYPE:", type(global_v))
print("GLOBAL LEN:", len(global_v))
if len(global_v) > 0:
    print("FIRST ELEMENT:", global_v[0], type(global_v[0]))
    if type(global_v[0]) == list:
        print("NESTED LEN:", len(global_v[0]))
