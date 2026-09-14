// Register Service Worker for offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.error('SW registration failed:', err));
    });
}

// Data management
let plants = JSON.parse(localStorage.getItem('plants')) || [];
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// DOM Elements
const plantListEl = document.getElementById('plant-list');
const addModal = document.getElementById('add-modal');
const addBtn = document.getElementById('add-btn');
const cancelBtn = document.getElementById('cancel-btn');
const addForm = document.getElementById('add-form');

// Request Notification permission required for App Badging on iOS 16.4+
async function ensurePermissions() {
    if ('Notification' in window && Notification.permission !== 'granted') {
        try {
            await Notification.requestPermission();
        } catch (e) {
            console.error("Permission request failed", e);
        }
    }
}

// Update iOS App Badge
async function updateAppBadge() {
    if (!('setAppBadge' in navigator)) return;

    let overdueCount = 0;
    const now = Date.now();
    plants.forEach(plant => {
        const nextWaterDate = plant.lastWatered + (plant.interval * MS_PER_DAY);
        if (now >= nextWaterDate) {
            overdueCount++;
        }
    });

    try {
        if (overdueCount > 0) {
            await navigator.setAppBadge(overdueCount);
        } else {
            await navigator.clearAppBadge();
        }
    } catch (e) {
        console.error("Failed to update badge", e);
    }
}

function savePlants() {
    localStorage.setItem('plants', JSON.stringify(plants));
    updateAppBadge();
}

function renderPlants() {
    plantListEl.innerHTML = '';
    const now = Date.now();

    plants.forEach((plant, index) => {
        const nextWaterDate = plant.lastWatered + (plant.interval * MS_PER_DAY);
        const daysLeft = Math.ceil((nextWaterDate - now) / MS_PER_DAY);
        
        let statusText = '';
        let isOverdue = false;

        if (daysLeft < 0) {
            statusText = `Overdue by ${Math.abs(daysLeft)} day(s)`;
            isOverdue = true;
        } else if (daysLeft === 0) {
            statusText = 'Water today';
            isOverdue = true;
        } else {
            statusText = `Water in ${daysLeft} day(s)`;
        }

        const card = document.createElement('div');
        card.className = 'plant-card';
        card.innerHTML = `
            <div class="plant-info">
                <h3>${plant.name}</h3>
                <p class="${isOverdue ? 'overdue' : ''}">${statusText}</p>
            </div>
            <button class="water-btn" data-index="${index}">Watered</button>
        `;
        plantListEl.appendChild(card);
    });
}

// Event Listeners
addBtn.addEventListener('click', () => addModal.classList.remove('hidden'));

cancelBtn.addEventListener('click', () => {
    addModal.classList.add('hidden');
    addForm.reset();
});

addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await ensurePermissions(); // Trigger permission prompt on user interaction

    const name = document.getElementById('plant-name').value;
    const interval = parseInt(document.getElementById('water-interval').value, 10);
    
    plants.push({
        name,
        interval,
        lastWatered: Date.now()
    });

    savePlants();
    renderPlants();
    addModal.classList.add('hidden');
    addForm.reset();
});

plantListEl.addEventListener('click', async (e) => {
    if (e.target.classList.contains('water-btn')) {
        await ensurePermissions(); // Ensure permissions are set
        const index = e.target.getAttribute('data-index');
        plants[index].lastWatered = Date.now();
        savePlants();
        renderPlants();
    }
});

// Initial Render
renderPlants();
updateAppBadge();