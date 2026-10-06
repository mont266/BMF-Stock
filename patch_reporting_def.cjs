const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /const ReportingPage = \(\{ filters, setFilters, reportData, setReportData, loading, setLoading, itemTypes, stock, setError, setIsPrintInfoModalOpen \}\) => \{/,
    "const ReportingPage = ({ teams, filters, setFilters, reportData, setReportData, loading, setLoading, itemTypes, stock, setError, setIsPrintInfoModalOpen }) => {"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
