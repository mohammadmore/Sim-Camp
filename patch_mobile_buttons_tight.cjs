const fs = require('fs');

let css = fs.readFileSync('public/style.css', 'utf8');

// Replace the existing mobile media query with a tighter one
const oldMediaQuery = /@media \(max-width: 650px\) \{[\s\S]*?\}\s*\}/;

const newMediaQuery = `@media (max-width: 650px) {
    .main-action-btn {
        padding: 12px; /* Tighter padding */
        border-radius: 12px;
        flex: 1; /* Force them to share available space equally */
        justify-content: center; /* Center the icon */
        min-width: 44px; /* Minimum touch target size */
    }
    .main-action-btn .btn-text {
        display: none;
    }
    .main-action-btn i, .main-action-btn svg {
        width: 20px;
        height: 20px;
        margin: 0; /* Remove any default margins */
    }
    /* Update the container holding the buttons to prevent wrapping on very small screens */
    #dashboardSection > div:first-of-type {
        gap: 8px !important; /* Smaller gap */
        flex-wrap: nowrap !important; /* Force single line */
        width: 100%;
        overflow-x: auto; /* Allow scrolling if it gets impossibly narrow (e.g., iPhone SE) */
        padding-bottom: 5px; /* Space for potential scrollbar */
    }
    #dashboardSection > div:first-of-type::-webkit-scrollbar {
        height: 4px;
    }
    #dashboardSection > div:first-of-type::-webkit-scrollbar-thumb {
        background: var(--glass-border);
        border-radius: 4px;
    }
}`;

css = css.replace(oldMediaQuery, newMediaQuery);
fs.writeFileSync('public/style.css', css);
console.log('Tight mobile layout patched');
