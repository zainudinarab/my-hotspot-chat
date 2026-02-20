const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcrypt');

app.use(express.static('public'));
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    next();
});

let db;
const onlineUsers = {}; // { username: { socketId, displayName, avatar } }

(async () => {
    db = await open({ filename: 'chat_database.db', driver: sqlite3.Database });
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY, 
            display_name TEXT,
            password TEXT,
            avatar TEXT
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, 
            sender TEXT, 
            receiver TEXT, 
            content TEXT, 
            is_read INTEGER DEFAULT 0,
            time DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    io.on('connection', (socket) => {
        
        // --- AUTH SISTEM ---
        socket.on('register', async (data) => {
            const { username, displayName, password } = data;
            if(!username || !password) return socket.emit('reg error', 'Data tidak lengkap');
            
            const existing = await db.get('SELECT * FROM users WHERE username = ?', [username]);
            if (existing) return socket.emit('reg error', 'Username sudah ada!');

            const hashedPassword = await bcrypt.hash(password, 10);
            const avatar = `https://i.pravatar.cc/150?u=${username}`;
            
            await db.run('INSERT INTO users (username, display_name, password, avatar) VALUES (?, ?, ?, ?)', 
                [username, displayName || username, hashedPassword, avatar]);
            
            socket.emit('reg success', 'Registrasi berhasil! Silakan login.');
        });

        socket.on('login', async (data) => {
            const user = await db.get('SELECT * FROM users WHERE username = ?', [data.username]);
            if (!user || !(await bcrypt.compare(data.password, user.password))) {
                return socket.emit('login error', 'Username/Password salah!');
            }

            onlineUsers[user.username] = { ...user, socketId: socket.id };
            socket.emit('login success', user);
            await broadcastUserList();
        });

        // --- CHAT SISTEM ---
        socket.on('get private history', async (targetUser) => {
            const me = getUserBySocketId(socket.id);
            if (!me) return;

            await db.run('UPDATE messages SET is_read = 1 WHERE sender = ? AND receiver = ?', [targetUser, me.username]);
            
            const history = await db.all(`
                SELECT * FROM messages 
                WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) 
                ORDER BY id ASC LIMIT 100`, [me.username, targetUser, targetUser, me.username]
            );
            socket.emit('chat history', history);
            await broadcastUserList(); 
        });

        socket.on('send private message', async (data) => {
            const me = getUserBySocketId(socket.id);
            if (me) {
                await db.run('INSERT INTO messages (sender, receiver, content) VALUES (?, ?, ?)', 
                    [me.username, data.receiver, data.content]);
                
                const msg = { sender: me.username, receiver: data.receiver, content: data.content };
                io.emit('new private message', msg);
                await broadcastUserList();
            }
        });

        // --- FITUR TYPING ---
        socket.on('typing', (data) => {
            const me = getUserBySocketId(socket.id);
            if(me) {
                const target = onlineUsers[data.receiver];
                if(target) io.to(target.socketId).emit('is typing', { sender: me.username });
            }
        });

        socket.on('update avatar', async (url) => {
            const me = getUserBySocketId(socket.id);
            if(me) {
                await db.run('UPDATE users SET avatar = ? WHERE username = ?', [url, me.username]);
                onlineUsers[me.username].avatar = url;
                await broadcastUserList();
            }
        });

        socket.on('disconnect', async () => {
            for (let uname in onlineUsers) {
                if (onlineUsers[uname].socketId === socket.id) {
                    delete onlineUsers[uname];
                    break;
                }
            }
            await broadcastUserList();
        });
    });

    async function broadcastUserList() {
        const allUsers = await db.all('SELECT username, display_name, avatar FROM users');
        const unreads = await db.all('SELECT sender, receiver, COUNT(*) as count FROM messages WHERE is_read = 0 GROUP BY sender, receiver');

        let usersWithStatus = allUsers.map(u => ({
            ...u,
            status: onlineUsers[u.username] ? 'online' : 'offline',
            unreadCounts: unreads.filter(r => r.sender === u.username)
        }));

        // Sorting: Online di atas
        usersWithStatus.sort((a, b) => (a.status === 'online' ? -1 : 1));
        io.emit('update users', usersWithStatus);
    }

    function getUserBySocketId(id) {
        return Object.values(onlineUsers).find(u => u.socketId === id);
    }

    http.listen(8000, '0.0.0.0', () => console.log('Server Port 8000 Ready'));
})();