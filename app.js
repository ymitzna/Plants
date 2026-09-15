// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => console.error('SW registration failed:', err));
    });
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// IndexedDB Setup
const DB_NAME = 'PlantTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'plants';
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (e) => reject('IndexedDB error: ' + e.target.error);
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

// DB Operations
function getAllPlants() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getPlant(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function savePlant(plant) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = plant.id ? store.put(plant) : store.add(plant);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function deletePlantFromDB(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// DOM Elements
const plantListEl = document.getElementById('plant-list');
const addModal = document.getElementById('add-modal');
const addBtn = document.getElementById('add-btn');
const cancelAddBtn = document.getElementById('cancel-add-btn');
const addForm = document.getElementById('add-form');

const editModal = document.getElementById('edit-modal');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const editForm = document.getElementById('edit-form');
const deleteBtn = document.getElementById('delete-btn');
const toastEl = document.getElementById('toast');

const searchInput = document.getElementById('search-input');
const filterSelect = document.getElementById('filter-select');
const sortSelect = document.getElementById('sort-select');
const waterAllBtn = document.getElementById('water-all-btn');

let toastTimeout;

// Utilities
async function ensurePermissions() {
    if ('Notification' in window && Notification.permission !== 'granted') {
        try {
            await Notification.requestPermission();
        } catch (e) {
            console.error("Permission request failed", e);
        }
    }
}

async function updateAppBadge(plants) {
    if (!('setAppBadge' in navigator)) return; 
    let overdueCount = 0;
    const now = Date.now();
    plants.forEach(plant => {
        const { daysLeft } = calculatePlantStatus(plant, now);
        if (daysLeft <= 0) overdueCount++;
    });
    try {
        if (overdueCount > 0) await navigator.setAppBadge(overdueCount);
        else await navigator.clearAppBadge();
    } catch (e) {
        console.error("Failed to update badge", e);
    }
}

function showToast(message) {
    clearTimeout(toastTimeout);
    toastEl.textContent = message;
    toastEl.classList.add('show');
    toastTimeout = setTimeout(() => toastEl.classList.remove('show'), 2500);
}

// Image Compression using Canvas
function compressImage(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = event => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality)); // Convert to compressed JPEG
            };
            img.onerror = reject;
            img.src = event.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function calculatePlantStatus(plant, now) {
    const lastWatered = plant.history && plant.history.length > 0 ? plant.history[plant.history.length - 1] : plant.lastWatered;
    const baseNextWaterDate = lastWatered + (plant.interval * MS_PER_DAY);
    const nextWaterDate = Math.max(baseNextWaterDate, plant.snoozedUntil || 0);
    const daysLeft = Math.ceil((nextWaterDate - now) / MS_PER_DAY);
    const totalIntervalDays = Math.ceil((nextWaterDate - lastWatered) / MS_PER_DAY);
    return { lastWatered, nextWaterDate, daysLeft, totalIntervalDays };
}

// Core Rendering
async function renderPlants() {
    plantListEl.innerHTML = '';
    const now = Date.now();
    let plants = await getAllPlants();
    updateAppBadge(plants);

    // Apply Search
    const searchTerm = searchInput.value.toLowerCase();
    if (searchTerm) {
        plants = plants.filter(p => p.name.toLowerCase().includes(searchTerm) || (p.species && p.species.toLowerCase().includes(searchTerm)));
    }

    // Apply Filter
    const filterTerm = filterSelect.value;
    let dueCount = 0;
    
    // Add computed status to plants for sorting/filtering
    plants = plants.map(plant => ({ ...plant, computedStatus: calculatePlantStatus(plant, now) }));
    
    if (filterTerm === 'due') {
        plants = plants.filter(p => p.computedStatus.daysLeft <= 0);
    }
    
    // Calculate total due globally for the Bulk Action button
    const allPlants = await getAllPlants();
    allPlants.forEach(p => {
        if (calculatePlantStatus(p, now).daysLeft <= 0) dueCount++;
    });

    waterAllBtn.style.display = dueCount > 0 && plants.length > 0 ? 'block' : 'none';

    // Apply Sort
    const sortTerm = sortSelect.value;
    if (sortTerm === 'urgency') {
        plants.sort((a, b) => a.computedStatus.nextWaterDate - b.computedStatus.nextWaterDate);
    } else if (sortTerm === 'name') {
        plants.sort((a, b) => a.name.localeCompare(b.name));
    }

    if (plants.length === 0) {
        plantListEl.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: var(--text-secondary);">
                <div style="font-size: 54px; margin-bottom: 16px;">🪴</div>
                <h3 style="color: var(--text-primary); margin-bottom: 8px;">No Plants Found</h3>
            </div>
        `;
        return;
    }

    plants.forEach(plant => {
        const { daysLeft, totalIntervalDays } = plant.computedStatus;
        
        let statusText = '';
        let isOverdue = false;
        let progressPercent = 100;
        let progressColor = 'var(--accent-color)';

        if (daysLeft < 0) {
            statusText = `Overdue by ${Math.abs(daysLeft)} day(s)`;
            isOverdue = true;
            progressColor = 'var(--danger-color)';
        } else if (daysLeft === 0) {
            statusText = 'Water today';
            isOverdue = true;
            progressColor = 'var(--warning-color)';
        } else {
            statusText = `Water in ${daysLeft} day(s)`;
            const daysElapsed = totalIntervalDays - daysLeft;
            progressPercent = Math.max(0, Math.min(100, (daysElapsed / totalIntervalDays) * 100));
        }

        const photoHtml = plant.photo 
            ? `<img src="${plant.photo}" alt="${plant.name}">` 
            : `🪴`;

        const card = document.createElement('div');
        card.className = 'plant-card';
        card.innerHTML = `
            <div class="plant-header">
                <div class="plant-photo-container">${photoHtml}</div>
                <div class="plant-info">
                    <h3>${plant.name}</h3>
                    ${plant.species ? `<div class="plant-species">${plant.species}</div>` : ''}
                    <p class="plant-status ${isOverdue ? 'overdue' : ''}">${statusText}</p>
                </div>
            </div>
            <div class="progress-bar-bg">
                <div class="progress-bar-fill" style="width: ${progressPercent}%; background-color: ${progressColor};"></div>
            </div>
            <div class="card-actions">
                <button class="snooze-btn" data-id="${plant.id}">+1 Day</button>
                <button class="water-btn" data-id="${plant.id}">Watered</button>
                <button class="edit-btn" data-id="${plant.id}">Edit</button>
            </div>
        `;
        plantListEl.appendChild(card);
    });
}

// Search, Filter, Sort Listeners
searchInput.addEventListener('input', renderPlants);
filterSelect.addEventListener('change', renderPlants);
sortSelect.addEventListener('change', renderPlants);

// Bulk Action Listener
waterAllBtn.addEventListener('click', async () => {
    await ensurePermissions();
    const now = Date.now();
    const plants = await getAllPlants();
    let wateredCount = 0;

    for (let plant of plants) {
        const { daysLeft } = calculatePlantStatus(plant, now);
        if (daysLeft <= 0) {
            plant.lastWatered = now;
            if (!plant.history) plant.history = [];
            plant.history.push(now);
            plant.snoozedUntil = null;
            await savePlant(plant);
            wateredCount++;
        }
    }

    if (wateredCount > 0) {
        showToast(`Watered ${wateredCount} plant(s)!`);
        renderPlants();
    }
});

// Add Plant
addBtn.addEventListener('click', () => addModal.classList.add('show'));

cancelAddBtn.addEventListener('click', () => {
    addModal.classList.remove('show');
    setTimeout(() => addForm.reset(), 300); 
});

addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await ensurePermissions(); 

    const fileInput = document.getElementById('plant-photo');
    const photoDataUrl = await compressImage(fileInput.files[0]);
    const name = document.getElementById('plant-name').value;
    const species = document.getElementById('plant-species').value;
    const interval = parseInt(document.getElementById('water-interval').value, 10);
    const now = Date.now();
    
    await savePlant({
        name,
        species,
        interval,
        lastWatered: now,
        history: [now],
        snoozedUntil: null,
        photo: photoDataUrl
    });

    renderPlants();
    addModal.classList.remove('show');
    setTimeout(() => addForm.reset(), 300);
    showToast(`${name} added!`);
});

// List Actions
plantListEl.addEventListener('click', async (e) => {
    const id = e.target.getAttribute('data-id');
    if (!id) return;
    const plantId = Number(id);
    const plant = await getPlant(plantId);
    if (!plant) return;
    
    // Water Action
    if (e.target.classList.contains('water-btn')) {
        await ensurePermissions(); 
        const now = Date.now();
        plant.lastWatered = now;
        if (!plant.history) plant.history = [];
        plant.history.push(now);
        plant.snoozedUntil = null; 
        
        await savePlant(plant);
        renderPlants();
        showToast(`${plant.name} watered!`);
    }

    // Snooze Action
    if (e.target.classList.contains('snooze-btn')) {
        const lastWatered = plant.history && plant.history.length > 0 ? plant.history[plant.history.length - 1] : plant.lastWatered;
        const currentTarget = Math.max(lastWatered + (plant.interval * MS_PER_DAY), plant.snoozedUntil || 0, Date.now());
        plant.snoozedUntil = currentTarget + MS_PER_DAY;
        
        await savePlant(plant);
        renderPlants();
        showToast(`${plant.name} snoozed for 1 day.`);
    }
    
    // Open Edit Modal
    if (e.target.classList.contains('edit-btn')) {
        document.getElementById('edit-plant-id').value = plant.id;
        document.getElementById('edit-plant-name').value = plant.name;
        document.getElementById('edit-plant-species').value = plant.species || '';
        document.getElementById('edit-water-interval').value = plant.interval;
        
        const preview = document.getElementById('edit-photo-preview');
        if (plant.photo) {
            preview.src = plant.photo;
            preview.style.display = 'block';
        } else {
            preview.style.display = 'none';
        }

        editModal.classList.add('show');
    }
});

// Edit & Delete
cancelEditBtn.addEventListener('click', () => {
    editModal.classList.remove('show');
    setTimeout(() => editForm.reset(), 300);
});

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = Number(document.getElementById('edit-plant-id').value);
    const plant = await getPlant(id);
    
    plant.name = document.getElementById('edit-plant-name').value;
    plant.species = document.getElementById('edit-plant-species').value;
    plant.interval = parseInt(document.getElementById('edit-water-interval').value, 10);
    
    const fileInput = document.getElementById('edit-plant-photo');
    if (fileInput.files.length > 0) {
        plant.photo = await compressImage(fileInput.files[0]);
    }

    await savePlant(plant);
    renderPlants();
    editModal.classList.remove('show');
    showToast('Plant updated successfully.');
});

deleteBtn.addEventListener('click', async () => {
    const id = Number(document.getElementById('edit-plant-id').value);
    const plant = await getPlant(id);
    
    if(confirm(`Are you sure you want to delete ${plant.name}?`)) {
        await deletePlantFromDB(id);
        renderPlants();
        editModal.classList.remove('show');
        showToast(`${plant.name} deleted.`);
    }
});

// Initialize
initDB().then(() => renderPlants()).catch(err => console.error(err));
