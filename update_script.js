const fs = require('fs');
let c = fs.readFileSync('script.js', 'utf8');

c = c.replace(/buttonText = 'Copy Steps';/, `buttonText = 'Generate Fix';`);

c = c.replace(/        let actionHtml = '';\r?\n        if \(isLayout\) \{\r?\n            actionHtml = \`<button class="btn-copy-fix" onclick="copyText\('\\$\\{safeCopy\}'\)"\>\\$\\{buttonText\}<\/button>\`;\r?\n        \} else \{\r?\n            actionHtml = \`\r?\n                <select class="strength-select" id="strength-\\$\\{uniqueId\}" style="background:rgba\(255,255,255,0\.1\); color:#fff; border:1px solid rgba\(255,255,255,0\.2\); padding:4px 8px; border-radius:4px; font-size:0\.75rem; outline:none; margin-right: 8px;"\>\r?\n                    <option value="low"\>Low \(Fast\)<\/option\>\r?\n                    <option value="high" selected\>High \(Best\)<\/option>\r?\n                <\/select\>\r?\n                <button class="btn-copy-fix btn-generate-fix" id="btn-gen-\\$\\{uniqueId\}" style="background: var\(--color-primary\); color: white; border: none; box-shadow: 0 0 10px rgba\(59, 130, 246, 0\.4\);" onclick="generateFix\('\\$\\{uniqueId\}', \\$\\{i\}, '\\$\\{containerId\}'\)"\>\\$\\{buttonText\}<\/button\>\r?\n            \`;\r?\n        \}/, `        let actionHtml = \`
            <select class="strength-select" id="strength-\${uniqueId}" style="background:rgba(255,255,255,0.1); color:#fff; border:1px solid rgba(255,255,255,0.2); padding:4px 8px; border-radius:4px; font-size:0.75rem; outline:none; margin-right: 8px;">
                <option value="low">Low (Fast)</option>
                <option value="high" selected>High (Best)</option>
            </select>
            <button class="btn-copy-fix btn-generate-fix" id="btn-gen-\${uniqueId}" style="background: var(--color-primary); color: white; border: none; box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);" onclick="generateFix('\${uniqueId}', \${i}, '\${containerId}')">\${buttonText}</button>
        \`;`);

fs.writeFileSync('script.js', c);
console.log("Done");
