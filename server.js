const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http);
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
require('dotenv').config(); // Muat variabel dari .env

app.use(express.static('public'));
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    next();
});

let db;
const onlineUsers = {}; // { username: { socketId, displayName, avatar } }

(async () => {
    // Koneksi ke MySQL
    try {
        db = await mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'chat_hotspot',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
        console.log('Terhubung ke Database MySQL');
    } catch (err) {
        console.error('Gagal konek ke MySQL:', err);
        process.exit(1);
    }
    
    // Buat Tabel (MySQL Syntax)
    await db.query(`
        CREATE TABLE IF NOT EXISTS users (
            username VARCHAR(255) PRIMARY KEY, 
            display_name VARCHAR(255),
            password VARCHAR(255),
            avatar TEXT,
            group_id VARCHAR(255) DEFAULT 'global'
        )
    `);
    
    await db.query(`
        CREATE TABLE IF NOT EXISTS messages (
            id INT AUTO_INCREMENT PRIMARY KEY, 
            sender VARCHAR(255), 
            receiver VARCHAR(255), 
            group_id VARCHAR(255) DEFAULT 'global', 
            content TEXT, 
            is_read TINYINT DEFAULT 0,
            time DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    io.on('connection', (socket) => {
        
        // --- AUTH SISTEM ---
        socket.on('register', async (data) => {
            const { username, displayName, password, groupId } = data;
            if(!username || !password) return socket.emit('reg error', 'Data tidak lengkap');
            
            const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
            const existing = rows[0];
            
            if (existing) return socket.emit('reg error', 'Username sudah ada!');

            const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10);
            const rand = Math.floor(Math.random() * 14) + 1;
            const avatar = `img/namanya${rand}.jpeg`;
            
            await db.execute('INSERT INTO users (username, display_name, password, avatar, group_id) VALUES (?, ?, ?, ?, ?)', 
        [username, displayName || username, hashedPassword, avatar, groupId || 'global']);
            
            socket.emit('reg success', 'Registrasi berhasil! Silakan login.');
        });

        socket.on('login', async (data) => {
            const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [data.username]);
            const user = rows[0];
            
            if (!user || !(await bcrypt.compare(data.password, user.password))) {
                return socket.emit('login error', 'Username/Password salah!');
            }

            onlineUsers[user.username] = { ...user, socketId: socket.id };
            // Bergabung ke "Room" socket berdasarkan group_id
            socket.join(user.group_id);
            socket.emit('login success', user);
            await broadcastUserList(user.group_id);
        });

        // --- CHAT SISTEM ---
        socket.on('get private history', async (targetUser) => {
            const me = getUserBySocketId(socket.id);
            if (!me) return;

            await db.execute('UPDATE messages SET is_read = 1 WHERE sender = ? AND receiver = ?', [targetUser, me.username]);
            
            // Tambahkan filter group_id agar history tidak bercampur jika user punya nama sama di grup lain
            const [history] = await db.query(`
                SELECT * FROM messages 
                WHERE ((sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?))
                AND group_id = ? 
                ORDER BY id ASC LIMIT 100`, [me.username, targetUser, targetUser, me.username, me.group_id]
            );
            socket.emit('chat history', history);
            await broadcastUserList(me.group_id); // Kirim groupId-nya di sini
        });

        socket.on('send private message', async (data) => {
            const me = getUserBySocketId(socket.id);
            if (me) {
                await db.execute(
                    'INSERT INTO messages (sender, receiver, content, group_id) VALUES (?, ?, ?, ?)', 
                    [me.username, data.receiver, data.content, me.group_id]
                );
                
                const msg = { sender: me.username, receiver: data.receiver, content: data.content };
                
                // Kirim hanya ke room group tersebut
                io.to(me.group_id).emit('new private message', msg);
            }
        });
        // User bergabung ke grup tertentu (berdasarkan ID dari widget)
        socket.on('join group', (groupId) => {
            socket.join(groupId);
            console.log(`User bergabung ke grup: ${groupId}`);
        });
        // Kirim pesan ke grup
        socket.on('send group message', async (data) => {
            const me = getUserBySocketId(socket.id);
            if (me) {
                // Simpan ke database dengan group_id
                await db.execute(
                    'INSERT INTO messages (sender, group_id, content) VALUES (?, ?, ?)', 
                    [me.username, data.groupId, data.content]
                );
                
                const msg = { 
                    sender: me.username, 
                    content: data.content, 
                    groupId: data.groupId,
                    time: new Date()
                };

                // Kirim hanya ke orang-orang di grup yang sama
                io.to(data.groupId).emit('new group message', msg);
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
                await db.execute('UPDATE users SET avatar = ? WHERE username = ?', [url, me.username]);
                onlineUsers[me.username].avatar = url;
                await broadcastUserList(me.group_id); // Tambahkan me.group_id
            }
        });

        socket.on('disconnect', async () => {
            let userGroupId = null;
            for (let uname in onlineUsers) {
                if (onlineUsers[uname].socketId === socket.id) {
                    userGroupId = onlineUsers[uname].group_id; // Ambil groupId-nya
                    delete onlineUsers[uname];
                    break;
                }
            }
            // Update daftar user HANYA untuk grup tersebut
            if (userGroupId) {
                await broadcastUserList(userGroupId);
            }
        });
    });

   async function broadcastUserList(groupId) {
        if (!groupId) return;
        // Ambil user yang hanya satu group_id
        const [allUsers] = await db.query(
            'SELECT username, display_name, avatar FROM users WHERE group_id = ?', 
            [groupId]
        );
        
        const [unreads] = await db.query(
            'SELECT sender, receiver, COUNT(*) as count FROM messages WHERE is_read = 0 GROUP BY sender, receiver'
        );
        let usersWithStatus = allUsers.map(u => ({
        ...u,
        status: onlineUsers[u.username] ? 'online' : 'offline',
        unreadCounts: unreads.filter(r => r.sender === u.username)
    }));

        // Sorting: Online di atas
        usersWithStatus.sort((a, b) => (a.status === 'online' ? -1 : 1));

    // Kirim list user HANYA ke orang-orang di group_id tersebut
    io.to(groupId).emit('update users', usersWithStatus);
    }

    function getUserBySocketId(id) {
        return Object.values(onlineUsers).find(u => u.socketId === id);
    }

    const PORT = process.env.PORT || 8000;
    http.listen(PORT, '0.0.0.0', () => console.log(`Server Port ${PORT} Ready`));
})();