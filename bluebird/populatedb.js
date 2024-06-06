const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');

const dbFileName = 'microblog.db';

async function initializeDB() {
    const db = await sqlite.open({ filename: dbFileName, driver: sqlite3.Database });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            hashedGoogleId TEXT NOT NULL UNIQUE,
            avatar_url TEXT,
            memberSince DATETIME NOT NULL
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            username TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            likes INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS collected_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            post_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (post_id) REFERENCES posts(id)
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            postId INTEGER,
            username TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME NOT NULL,
            FOREIGN KEY (postId) REFERENCES posts(id)
        );
    `);

    const users = [
        { username: 'user1', hashedGoogleId: 'uniqueGoogleId1', avatar_url: '', memberSince: '2024-01-01 12:00:00' },
        { username: 'user2', hashedGoogleId: 'uniqueGoogleId2', avatar_url: '', memberSince: '2024-01-02 12:00:00' }
    ];

    const posts = [
        { title: 'First Post', content: 'This is the first post', username: 'user1', timestamp: '2024-01-01 12:30:00', likes: 0 },
        { title: 'Second Post', content: 'This is the second post', username: 'user2', timestamp: '2024-01-02 12:30:00', likes: 0 }
    ];

    for (const user of users) {
        const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [user.username]);
        if (!existingUser) {
            await db.run(
                'INSERT INTO users (username, hashedGoogleId, avatar_url, memberSince) VALUES (?, ?, ?, ?)',
                [user.username, user.hashedGoogleId, user.avatar_url, user.memberSince]
            );
        }
    }

    for (const post of posts) {
        const existingPost = await db.get('SELECT * FROM posts WHERE title = ? AND username = ?', [post.title, post.username]);
        if (!existingPost) {
            await db.run(
                'INSERT INTO posts (title, content, username, timestamp, likes) VALUES (?, ?, ?, ?, ?)',
                [post.title, post.content, post.username, post.timestamp, post.likes]
            );
        }
    }

    console.log('Database populated with initial data.');
    await db.close();
}

initializeDB().catch(err => {
    console.error('Error initializing database:', err);
});