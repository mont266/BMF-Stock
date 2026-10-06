const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

code = code.replace(
    /const ReportingPage = \(\{ teams, filters, setFilters, reportData, setReportData, loading, setLoading, itemTypes, stock, setError, setIsPrintInfoModalOpen \}\) => \{/,
    "const ReportingPage = ({ teams, dbLocations, filters, setFilters, reportData, setReportData, loading, setLoading, itemTypes, stock, setError, setIsPrintInfoModalOpen }) => {"
);

code = code.replace(
    /<ReportingPage\n                          teams=\{teams\}\n                          filters=\{reportFilters\}/,
    "<ReportingPage\n                          teams={teams}\n                          dbLocations={dbLocations}\n                          filters={reportFilters}"
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
