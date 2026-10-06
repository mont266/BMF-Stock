const fs = require('fs');
let code = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

const itemTypeSearchUI = `                                </div>
                                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700">
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <SearchIcon className="h-4 w-4 text-zinc-400" />
                                        </div>
                                        <input 
                                            type="text" 
                                            placeholder="Search item types..." 
                                            value={adminItemTypeSearchTerm}
                                            onChange={(e) => setAdminItemTypeSearchTerm(e.target.value)}
                                            className={\`\${formInputStyle} pl-9\`}
                                        />
                                    </div>
                                </div>
                                {itemTypesLoading ? (`;

code = code.replace(
    /<\/div>\n                                \{itemTypesLoading \? \(/,
    itemTypeSearchUI
);

const supplierSearchUI = `                                </div>
                                <div className="p-3 bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700">
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <SearchIcon className="h-4 w-4 text-zinc-400" />
                                        </div>
                                        <input 
                                            type="text" 
                                            placeholder="Search suppliers..." 
                                            value={adminSupplierSearchTerm}
                                            onChange={(e) => setAdminSupplierSearchTerm(e.target.value)}
                                            className={\`\${formInputStyle} pl-9\`}
                                        />
                                    </div>
                                </div>
                                {suppliersLoading ? (`;

code = code.replace(
    /<\/div>\n                                \{suppliersLoading \? \(/,
    supplierSearchUI
);

fs.writeFileSync('components/StockManagerApp.jsx', code);
