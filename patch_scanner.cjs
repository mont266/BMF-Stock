const fs = require('fs');
let code = fs.readFileSync('components/Scanner.jsx', 'utf8');

const oldCancelBtn = /<button \n\s*onClick=\{\(\) => onCancelRef\.current\(\)\}\n\s*className="mt-8 px-8 py-3 bg-white\/20 text-white rounded-lg backdrop-blur-md text-lg font-semibold"\n\s*aria-label="Cancel scanning"\n\s*>\n\s*Cancel\n\s*<\/button>/;

const newCancelBtn = `{!persistent && (
          <button 
            onClick={() => onCancelRef.current()}
            className="mt-8 px-8 py-3 bg-white/20 text-white rounded-lg backdrop-blur-md text-lg font-semibold hover:bg-white/30 transition-colors"
            aria-label="Cancel scanning"
          >
            Cancel
          </button>
        )}`;

code = code.replace(oldCancelBtn, newCancelBtn);

fs.writeFileSync('components/Scanner.jsx', code);
