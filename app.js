// Register Service Worker for offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.error('SW registration failed:', err));
    });
}

// Data management
let plants = JSON.parse(localStorage.getItem('plants')) || [];
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// DOM Elements - Add
const plantListEl = document.getElementById('plant-list');
const addModal = document.getElementById('add-modal');
const addBtn = document.getElementById('add-btn');
const cancelAddBtn = document.getElementById('cancel-add-btn');
const addForm = document.getElementById('add-form');

// DOM Elements - Edit/Delete
const editModal = document.getElementById('edit-modal');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const editForm = document.getElementById('edit-form');
const deleteBtn = document.getElementById('delete-btn');

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
    if (!('setAppBadge' in navigator)) return; //

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
            await navigator.setAppBadge(overdueCount); //
        } else {
            await navigator.clearAppBadge(); //
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
                ${plant.species ? `<div class="plant-species">${plant.species}</div>` : ''}
                <p class="plant-status ${isOverdue ? 'overdue' : ''}">${statusText}</p>
            </div>
            <div class="card-actions">
                <button class="water-btn" data-index="${index}">Watered</button>
                <button class="edit-btn" data-index="${index}">Edit</button>
            </div>
        `;
        plantListEl.appendChild(card);
    });
}

// Event Listeners - Add
addBtn.addEventListener('click', () => addModal.classList.remove('hidden'));

cancelAddBtn.addEventListener('click', () => {
    addModal.classList.add('hidden');
    addForm.reset();
});

addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await ensurePermissions(); 

    const name = document.getElementById('plant-name').value;
    const species = document.getElementById('plant-species').value;
    const interval = parseInt(document.getElementById('water-interval').value, 10);
    
    plants.push({
        name,
        species,
        interval,
        lastWatered: Date.now()
    });

    savePlants();
    renderPlants();
    addModal.classList.add('hidden');
    addForm.reset();
});

// Event Listeners - Edit & Delete
plantListEl.addEventListener('click', async (e) => {
    const index = e.target.getAttribute('data-index');
    
    // Water Action
    if (e.target.classList.contains('water-btn')) {
        await ensurePermissions(); 
        plants[index].lastWatered = Date.now();
        savePlants();
        renderPlants();
    }
    
    // Open Edit Modal Action
    if (e.target.classList.contains('edit-btn')) {
        const plant = plants[index];
        document.getElementById('edit-plant-index').value = index;
        document.getElementById('edit-plant-name').value = plant.name;
        document.getElementById('edit-plant-species').value = plant.species || '';
        document.getElementById('edit-water-interval').value = plant.interval;
        editModal.classList.remove('hidden');
    }
});

cancelEditBtn.addEventListener('click', () => {
    editModal.classList.add('hidden');
    editForm.reset();
});

editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const index = document.getElementById('edit-plant-index').value;
    plants[index].name = document.getElementById('edit-plant-name').value;
    plants[index].species = document.getElementById('edit-plant-species').value;
    plants[index].interval = parseInt(document.getElementById('edit-water-interval').value, 10);
    
    savePlants();
    renderPlants();
    editModal.classList.add('hidden');
});

deleteBtn.addEventListener('click', () => {
    const index = document.getElementById('edit-plant-index').value;
    if(confirm("Are you sure you want to delete this plant?")) {
        plants.splice(index, 1);
        savePlants();
        renderPlants();
        editModal.classList.add('hidden');
    }
});

// Initial Render
renderPlants();
updateAppBadge();
