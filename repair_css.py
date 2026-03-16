filepath = 'style.css'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
count = 0
for line in lines:
    if line.strip() == '/':
        count += 1
        continue
    new_lines.append(line)

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print(f"Removed {count} corrupted lines.")
