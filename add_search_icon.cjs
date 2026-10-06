const fs = require('fs');
let code = fs.readFileSync('components/Icons.jsx', 'utf8');

const searchIconStr = `export const SearchIcon = ({ className = "w-6 h-6", ...props }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
);
`;

code = code + '\n' + searchIconStr;

fs.writeFileSync('components/Icons.jsx', code);
