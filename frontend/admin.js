// admin.js - Admin Dashboard Functionality with AI Priority Detection

// --- 1. Firebase Configuration ---
const firebaseConfig = {
    apiKey: "AIzaSyAAcJtQ-rr-7FRLOjipC1XNsHgODLCvs00",
    authDomain: "smart-city-ada8d.firebaseapp.com",
    projectId: "smart-city-ada8d",
    messagingSenderId: "198348279885",
    appId: "1:198348279885:web:cb24e8196a3f7bc05ecc04",
    measurementId: "G-144YHLM2GJ"
};

// Initialize Firebase
let auth = null;
let db = null;
let firestore = null;
let map = null;
let markers = [];

if (typeof firebase !== 'undefined' && firebase.initializeApp) {
    try {
        firebase.initializeApp(firebaseConfig);
        auth = firebase.auth();
        db = firebase.firestore();
        firestore = firebase.firestore();
        
        auth.onAuthStateChanged(user => {
            if (!user) auth.signInAnonymously().catch(console.error);
        });
    } catch (e) {
        console.error('Firebase initialization error', e);
    }
}

// --- 2. Initialize Admin Dashboard ---
document.addEventListener('DOMContentLoaded', () => {
    initAdminMap();
    loadDashboardStats();
    loadRecentReports();
    loadPriorityQueue();
    loadResolvedReports();
    setupRealtimeListeners();
});

// --- 3. Admin Map with Markers ---
function initAdminMap() {
    const mapElement = document.getElementById('adminMap');
    if (!mapElement || typeof L === 'undefined') return;

    map = L.map('adminMap').setView([20.5937, 78.9629], 5);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

function updateMapMarkers(reports) {
    if (!map) return;
    
    // Clear existing markers
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];

    // Priority-based colors (more important = redder)
    const priorityColors = {
        'critical': '#dc2626',   // red-600
        'high': '#f97316',      // orange-500
        'medium': '#fbbf24',     // amber-400
        'low': '#22c55e'        // green-500
    };

    reports.forEach(doc => {
        const data = doc.data();
        if (data.latitude && data.longitude) {
            const priority = data.priority || 'medium';
            const color = priorityColors[priority] || priorityColors['medium'];
            
            const marker = L.circleMarker([data.latitude, data.longitude], {
                radius: 10,
                fillColor: color,
                color: '#fff',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.85
            }).addTo(map);

            marker.bindPopup(`
                <div class="text-sm">
                    <strong>${data.issue || 'Unknown'}</strong><br>
                    <span class="text-xs">Priority: <b>${priority.toUpperCase()}</b></span><br>
                    <span class="text-xs">Status: ${data.status}</span><br>
                    <span class="text-xs text-gray-500">${data.address || 'No address'}</span>
                </div>
            `);

            markers.push(marker);
        }
    });

    // Fit map to markers
    if (markers.length > 0) {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.1));
    }
}

// --- 4. Dashboard Stats ---
async function loadDashboardStats() {
    if (!db) return;

    try {
        const reportsSnapshot = await db.collection('reports').get();
        const total = reportsSnapshot.size;
        
        let pending = 0;
        let resolved = 0;
        let critical = 0;
        let high = 0;

        reportsSnapshot.forEach(doc => {
            const data = doc.data();
            // Count by status
            if (data.status === 'pending' || data.status === 'active') pending++;
            if (data.status === 'resolved') resolved++;
            // Count by priority
            if (data.priority === 'critical') critical++;
            if (data.priority === 'high') high++;
        });

        // Update UI elements
        updateStatCard('totalReports', total);
        updateStatCard('pendingAction', pending);
        updateStatCard('resolved', resolved);
        updateStatCard('critical', critical);
        updateStatCard('highPriority', high);
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function updateStatCard(elementId, value) {
    // Try to find by data attribute first
    const element = document.querySelector(`[data-stat="${elementId}"]`);
    if (element) {
        element.textContent = value;
        return;
    }
    
    // Fallback: update by order
    const cards = document.querySelectorAll('.bg-white\\/90.rounded-2xl');
    const statMap = {
        'totalReports': 0,
        'pendingAction': 1,
        'resolved': 2,
        'critical': 3,
        'highPriority': 4
    };
    
    const index = statMap[elementId];
    if (cards[index]) {
        const numberEl = cards[index].querySelector('.font-display.text-3xl, .text-3xl');
        if (numberEl) numberEl.textContent = value;
    }
}

// --- Priority Badge Functions ---
function getPriorityBadge(priority) {
    const badges = {
        'critical': 'bg-red-100 text-red-700 border-red-300',
        'high': 'bg-orange-100 text-orange-700 border-orange-300',
        'medium': 'bg-amber-100 text-amber-700 border-amber-300',
        'low': 'bg-green-100 text-green-700 border-green-300'
    };
    return badges[priority] || badges['medium'];
}

function getStatusColor(status) {
    const colors = {
        'pending': 'bg-rose-500',
        'active': 'bg-sky-500',
        'resolved': 'bg-emerald-500'
    };
    return colors[status] || colors['pending'];
}

function getStatusBadge(status) {
    const badges = {
        'pending': 'bg-rose-100 text-rose-700',
        'active': 'bg-sky-100 text-sky-700',
        'resolved': 'bg-emerald-100 text-emerald-700'
    };
    return badges[status] || badges['pending'];
}

// --- 5. Recent Reports List ---
function loadRecentReports() {
    const reportsList = document.getElementById('reportsList');
    if (!reportsList || !db) {
        console.log('DB or reportsList not found:', { db: !!db, reportsList: !!reportsList });
        return;
    }

    console.log('Loading reports from Firebase...');
    
    db.collection('reports')
        .orderBy('createdAt', 'desc')
        .limit(20)
        .onSnapshot((snapshot) => {
            console.log('Reports loaded:', snapshot.size);
            reportsList.innerHTML = '';
            
            if (snapshot.empty) {
                reportsList.innerHTML = '<div class="py-4 text-slate-500 italic">No reports found.</div>';
                return;
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                console.log('Report:', doc.id, 'Status:', data.status);
                const createdDate = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'Unknown';
                const priority = data.priority || 'medium';
                const docId = doc.id;
                
                // Show action buttons based on current status
                const isResolved = data.status === 'resolved';
                console.log('Is resolved:', isResolved, 'Status:', data.status);
                const actionButtons = isResolved 
                    ? `<span class="text-emerald-600 text-sm font-medium">✓ Resolved</span>`
                    : `<div class="flex gap-2">
                        <button data-id="${docId}" data-status="active" class="resolve-btn px-2 py-1 text-xs bg-sky-100 text-sky-700 rounded hover:bg-sky-200">Active</button>
                        <button data-id="${docId}" data-status="resolved" class="resolve-btn px-2 py-1 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200">Resolve</button>
                       </div>`;
                
                const item = document.createElement('div');
                item.className = 'py-4 flex items-center justify-between hover:bg-slate-50 transition border-b border-slate-100';
                item.innerHTML = `
                    <div class="flex items-center gap-4">
                        <div class="w-2 h-2 rounded-full ${getStatusColor(data.status)}"></div>
                        <div>
                            <p class="font-medium text-slate-800">${data.issue || 'Unknown Issue'}</p>
                            <p class="text-xs text-slate-500">${data.address || 'No address'} • ${createdDate}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="px-2 py-1 text-xs rounded-full border ${getPriorityBadge(priority)}">${priority.toUpperCase()}</span>
                        <span class="px-2 py-1 text-xs rounded-full ${getStatusBadge(data.status)}">${data.status}</span>
                        ${actionButtons}
                    </div>
                `;
                reportsList.appendChild(item);
            });

            // Attach event listeners to buttons
            document.querySelectorAll('.resolve-btn').forEach(btn => {
                btn.addEventListener('click', function() {
                    const reportId = this.getAttribute('data-id');
                    const newStatus = this.getAttribute('data-status');
                    console.log('Resolve button clicked:', reportId, newStatus);
                    window.updateReportStatus(reportId, newStatus);
                });
            });

            // Update map with all reports
            updateMapMarkers(snapshot.docs);
        }, (error) => {
            console.error('Error loading reports:', error);
        });
}

// --- 6. Priority Queue (Critical/High First) ---
function loadPriorityQueue() {
    const queueContainer = document.querySelector('.space-y-6 > div:first-child .mt-4');
    if (!queueContainer || !db) return;

    // Order by priority: critical > high > medium > low
    db.collection('reports')
        .where('status', 'in', ['pending', 'active'])
        .orderBy('createdAt', 'asc')
        .limit(10)
        .onSnapshot((snapshot) => {
            queueContainer.innerHTML = '';
            
            if (snapshot.empty) {
                queueContainer.innerHTML = '<div class="text-slate-500 text-sm">No pending items</div>';
                return;
            }

            // Sort by priority manually
            const priorityOrder = { 'critical': 0, 'high': 1, 'medium': 2, 'low': 3 };
            const sortedDocs = snapshot.docs.sort((a, b) => {
                const priorityA = priorityOrder[a.data().priority] ?? 2;
                const priorityB = priorityOrder[b.data().priority] ?? 2;
                return priorityA - priorityB;
            });

            sortedDocs.forEach(doc => {
                const data = doc.data();
                const priority = data.priority || 'medium';
                const priorityColor = {
                    'critical': 'bg-red-500',
                    'high': 'bg-orange-500',
                    'medium': 'bg-amber-400',
                    'low': 'bg-green-400'
                }[priority];
                
                const item = document.createElement('div');
                item.className = 'flex items-start gap-3 py-2';
                item.innerHTML = `
                    <span class="w-2.5 h-2.5 rounded-full ${priorityColor} mt-2"></span>
                    <div class="flex-1">
                        <p class="text-sm font-medium text-slate-800">${data.issue || 'Unknown'}</p>
                        <p class="text-xs text-slate-500">${data.address || 'No address'}</p>
                        <span class="text-xs ${priority === 'critical' ? 'text-red-600 font-bold' : 'text-slate-400'}">${priority.toUpperCase()} PRIORITY</span>
                    </div>
                `;
                queueContainer.appendChild(item);
            });
        });
}

// --- 6b. Resolved Reports Box ---
function loadResolvedReports() {
    const resolvedList = document.getElementById('resolvedList');
    const resolvedCount = document.getElementById('resolvedCount');
    if (!resolvedList || !db) return;

    db.collection('reports')
        .where('status', '==', 'resolved')
        .orderBy('createdAt', 'desc')
        .limit(20)
        .onSnapshot((snapshot) => {
            resolvedList.innerHTML = '';
            
            // Update count badge
            const count = snapshot.size;
            if (resolvedCount) {
                resolvedCount.textContent = `${count} resolved`;
            }
            
            if (snapshot.empty) {
                resolvedList.innerHTML = '<div class="py-4 text-slate-500 italic">No resolved reports yet.</div>';
                return;
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                const createdDate = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'Unknown';
                const resolvedDate = data.resolvedAt ? new Date(data.resolvedAt.seconds * 1000).toLocaleDateString() : createdDate;
                const priority = data.priority || 'medium';
                
                const item = document.createElement('div');
                item.className = 'py-4 flex items-center justify-between hover:bg-slate-50 transition border-b border-slate-100';
                item.innerHTML = `
                    <div class="flex items-center gap-4">
                        <div class="w-2 h-2 rounded-full bg-emerald-500"></div>
                        <div>
                            <p class="font-medium text-slate-800">${data.issue || 'Unknown Issue'}</p>
                            <p class="text-xs text-slate-500">${data.address || 'No address'} • Resolved: ${resolvedDate}</p>
                        </div>
                    </div>
                    <div class="flex items-center gap-3">
                        <span class="px-2 py-1 text-xs rounded-full border ${getPriorityBadge(priority)}">${priority.toUpperCase()}</span>
                        <span class="px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-700">Resolved</span>
                    </div>
                `;
                resolvedList.appendChild(item);
            });
        });
}

// --- 7. Real-time Listeners ---
function setupRealtimeListeners() {
    if (!db) return;

    // Listen for all report changes - but don't reload if already using onSnapshot
    // The loadRecentReports, loadPriorityQueue already have their own onSnapshot listeners
    // This is just for additional real-time updates if needed
    db.collection('reports').onSnapshot(() => {
        loadDashboardStats();
    });
}

// --- 8. View Report Details ---
function viewReport(reportId) {
    if (!db) return;
    
    db.collection('reports').doc(reportId).get()
        .then(doc => {
            if (doc.exists) {
                const data = doc.data();
                const priority = data.priority || 'medium';
                const currentStatus = data.status || 'pending';
                
                // Show report details with action buttons
                const actionButtons = currentStatus === 'resolved' 
                    ? '✅ Already Resolved'
                    : `\n\nChoose action:\n[1] Mark as Active\n[2] Mark as Resolved\n[3] Cancel`;
                
                const choice = prompt(`
📋 REPORT DETAILS
─────────────────
Issue: ${data.issue}
Priority: ${priority.toUpperCase()}
Status: ${currentStatus.toUpperCase()}
Confidence: ${(data.confidence * 100).toFixed(1)}%

Description: ${data.description || 'N/A'}
Address: ${data.address || 'N/A'}
Location: ${data.latitude}, ${data.longitude}

🖼️ Image: ${data.imageUrl || 'N/A'}
${actionButtons}
`);
                
                if (choice === '1' && currentStatus !== 'resolved') {
                    updateReportStatus(reportId, 'active');
                } else if (choice === '2' && currentStatus !== 'resolved') {
                    updateReportStatus(reportId, 'resolved');
                }
            }
        })
        .catch(error => console.error('Error viewing report:', error));
}

// --- 8b. Update Report Status ---
window.updateReportStatus = function(reportId, newStatus) {
    if (!db) {
        alert('Database not initialized. Check console for errors.');
        console.log('db is:', db);
        return;
    }
    
    console.log('Updating report:', reportId, 'to status:', newStatus);
    
    // Build update data - add resolvedAt timestamp when marking as resolved
    const updateData = {
        status: newStatus
    };
    
    console.log('Update data:', updateData);
    
    db.collection('reports').doc(reportId).update(updateData)
    .then(() => {
        console.log('Status updated successfully!');
        alert(`✅ Report marked as ${newStatus.toUpperCase()}`);
    })
    .catch(error => {
        console.error('Error updating status:', error);
        alert('Error: ' + error.message + '\n\nCode: ' + error.code);
    });
}

// --- 9. Mobile Menu ---
const mobileMenuButton = document.getElementById('mobileMenuButton');
const mobileMenu = document.getElementById('mobileMenu');
if (mobileMenuButton && mobileMenu) {
    mobileMenuButton.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
    });
}

