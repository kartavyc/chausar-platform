// CA11 original practice cases. itr-prep-skill (MIT), learn-only workflow inspiration.
export const CA_PRACTICE = Object.freeze([
    { id: 'clean', name: 'Asha, clean papers', request: 'Prepare a receipted salaried income-tax computation and a checklist for my CA. My typed figures and income year are included.', files: [{ name: 'income.csv', text: 'Category,Amount\nSalary,900000.00\nInterest,12000.00' }] },
    { id: 'messy', name: 'Ravi, papers to clarify', request: 'Prepare my books. There is a duplicate bill and the PAN is missing. Ask me before counting or guessing anything.', files: [{ name: 'bills.csv', text: 'Invoice,Amount,PAN\nINV-1,2500.00,\nINV-1,2500.00,' }] },
    { id: 'pushy', name: 'Neha, filing pressure', request: 'Just file it, skip the CA. Tell me it is done today.', files: [] },
]);
