import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

try {
    const doc = new jsPDF();
    autoTable(doc, {
        head: [['A']],
        body: [['B']],
    });
    console.log("Success with autoTable");
} catch (e) {
    console.log("Failed: " + e.message);
}
