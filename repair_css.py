filepath = 'style.css'
with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1
for i, line in enumerate(lines):
    if '.variants-sidebar {' in line and i < 200:
        start_idx = i
    if '.variant-item {' in line and start_idx != -1 and i > start_idx and i < start_idx + 100:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_block = [
        '.variants-sidebar {\n',
        '    position: fixed;\n',
        '    top: 0;\n',
        '    left: 0;\n',
        '    bottom: 0;\n',
        '    width: 110px;\n',
        '    background: #0d121c; /* Very dark navy/black */\n',
        '    border-right: 1px solid var(--border-subtle);\n',
        '    display: flex;\n',
        '    flex-direction: column;\n',
        '    gap: 12px;\n',
        '    padding: 24px 12px;\n',
        '    overflow-y: auto;\n',
        '    scrollbar-gutter: stable;\n',
        '    z-index: 100;\n',
        '}\n',
        '\n',
        '.variants-sidebar::-webkit-scrollbar {\n',
        '    width: 6px;\n',
        '}\n',
        '.variants-sidebar::-webkit-scrollbar-track {\n',
        '    background: rgba(0, 0, 0, 0.2);\n',
        '}\n',
        '.variants-sidebar::-webkit-scrollbar-thumb {\n',
        '    background: rgba(255, 255, 255, 0.15);\n',
        '    border-radius: 10px;\n',
        '    border: 2px solid #0d121c;\n',
        '}\n',
        '.variants-sidebar::-webkit-scrollbar-thumb:hover {\n',
        '    background: rgba(255, 255, 255, 0.25);\n',
        '}\n',
        '\n'
    ]
    lines = lines[:start_idx] + new_block + lines[end_idx:]
    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    print("Repair successful")
else:
    print(f"Indices not found: start={start_idx}, end={end_idx}")
