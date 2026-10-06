const CACHE_NAME = 'plant-tracker-v2';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './manifest.json',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', event => {
    event.waitUntil( 
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Stale-while-revalidate strategy
self.addEventListener('fetch', event => {
    // FIX: Do not intercept requests to Supabase to prevent indefinite caching of database queries[cite: 5]
    if (event.request.method !== 'GET' || event.request.url.includes('supabase.co')) return;
    
    event.respondWith(
        caches.match(event.request).then(cachedResponse => {
            const fetchPromise = fetch(event.request).then(networkResponse => {
                // Allow 'basic' and 'cors' types to ensure external CDNs are cached
                if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, networkResponse.clone());
                    });
                }
                return networkResponse;
            }).catch(() => {
                // Ignore fetch errors if offline
            });
            
            return cachedResponse || fetchPromise;
        })
    );
});

self.addEventListener('push', event => {
    let payload = { title: 'Plant Tracker', body: 'Time to check your plants!' };
    
    if (event.data) {
        try {
            payload = event.data.json(); 
        } catch (e) {
            payload.body = event.data.text(); 
        }
    }

    const options = {
        body: payload.body,
        icon: './icon-192.png',
        badge: './icon-192.png'
    };

    event.waitUntil(
        self.registration.showNotification(payload.title || 'Plant Tracker', options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url === '/' && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});
