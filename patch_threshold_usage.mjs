import fs from 'fs';

let content = fs.readFileSync('components/StockManagerApp.jsx', 'utf8');

content = content.replace(
  /(\s+)<AdminActionCard\s+icon=\{<CalculatorIcon\/>\}\s+title="Automate Stock Thresholds"\s+description="Automatically calculate and update the re-order threshold for all item types based on usage over the last 4 weeks."\s+onClick=\{handleCalculateThresholds\}\s+buttonText=\{isCalculatingThresholds \? 'Calculating...' : 'Calculate Thresholds'\}\s+disabled=\{isCalculatingThresholds\}\s+\/>/g,
  \`$1<AdminActionCard 
$1    icon={<CalculatorIcon/>}
$1    title="Automate Stock Thresholds"
$1    description="Automatically calculate and update the re-order threshold for all item types based on usage over the last 4 weeks."
$1    onClick={handleCalculateThresholds}
$1    buttonText={isCalculatingThresholds ? 'Calculating...' : 'Calculate Thresholds'}
$1    disabled={isCalculatingThresholds}
$1    infoAction={() => setIsThresholdInfoModalOpen(true)}
$1/>\`
);

fs.writeFileSync('components/StockManagerApp.jsx', content);
