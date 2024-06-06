const express = require('express');
const expressHandlebars = require('express-handlebars');
const session = require('express-session');
const { createCanvas } = require('canvas');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const dotenv = require('dotenv');
const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;

app.engine(
    'handlebars',
    expressHandlebars.engine({
        helpers: {
            toLowerCase: function (str) {
                return str.toLowerCase();
            },
            ifCond: function (v1, v2, options) {
                if (v1 === v2) {
                    return options.fn(this);
                }
                return options.inverse(this);
            },
            firstChar: function (str) {
                return str ? str.charAt(0).toUpperCase() : '';
            },
        },
    })
);

app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));

app.use(
    session({
        secret: 'oneringtorulethemall',
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false },
    })
);

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

passport.use(new GoogleStrategy({
    clientID: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    callbackURL: `http://localhost:${PORT}/auth/google/callback`
}, async (token, tokenSecret, profile, done) => {
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    let user = await db.get('SELECT * FROM users WHERE hashedGoogleId = ?', [profile.id]);
    if (!user) {
        await db.run('INSERT INTO users (username, hashedGoogleId, memberSince) VALUES (?, ?, ?)', [profile.displayName, profile.id, new Date().toISOString()]);
        user = await db.get('SELECT * FROM users WHERE hashedGoogleId = ?', [profile.id]);
    }
    return done(null, user);
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
    done(null, user);
});

app.use(passport.initialize());
app.use(passport.session());

app.get('/', async (req, res) => {
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const posts = await db.all('SELECT * FROM posts ORDER BY timestamp DESC');
    for (const post of posts) {
        post.comments = await db.all('SELECT * FROM comments WHERE postId = ? ORDER BY timestamp DESC', [post.id]);
        post.collected = req.session.userId && await db.get('SELECT * FROM collected WHERE postId = ? AND userId = ?', [post.id, req.session.userId]);
    }
    const user = req.session.userId ? await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]) : null;
    res.render('home', { posts, user, appName: 'BlueBird' });
});

app.get('/register', (req, res) => {
    res.render('loginRegister', { regError: req.query.error, appName: 'BlueBird' });
});

app.get('/login', (req, res) => {
    res.render('loginRegister', { loginError: req.query.error, appName: 'BlueBird' });
});

app.get('/error', (req, res) => {
    res.render('error');
});

app.get('/profile', isAuthenticated, async (req, res) => {
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    const userPosts = await db.all('SELECT * FROM posts WHERE username = ? ORDER BY timestamp DESC', [user.username]);
    const collectedPosts = await db.all('SELECT posts.* FROM posts JOIN collected ON posts.id = collected.postId WHERE collected.userId = ?', [req.session.userId]);
    res.render('profile', { user, posts: userPosts, collectedPosts, appName: 'BlueBird' });
});

app.post('/register', async (req, res) => {
    const { username } = req.body;
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (user) {
        return res.redirect('/register?error=User already exists');
    }
    await db.run('INSERT INTO users (username, memberSince) VALUES (?, ?)', [username, new Date().toISOString()]);
    const newUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    req.session.userId = newUser.id;
    req.session.loggedIn = true;
    res.redirect('/');
});

app.post('/login', async (req, res) => {
    const { username } = req.body;
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
        return res.redirect('/login?error=Invalid username');
    }
    req.session.userId = user.id;
    req.session.loggedIn = true;
    res.redirect('/');
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.post('/posts', isAuthenticated, async (req, res) => {
    const { title, content } = req.body;
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    await db.run('INSERT INTO posts (title, content, username, timestamp, likes) VALUES (?, ?, ?, ?, ?)', [title, content, user.username, new Date().toISOString(), 0]);
    res.redirect('/');
});

app.post('/like/:id', isAuthenticated, async (req, res) => {
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const post = await db.get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (post && post.username !== user.username) {
        await db.run('UPDATE posts SET likes = likes + 1 WHERE id = ?', [req.params.id]);
    }
    res.redirect('/');
});

app.post('/collect/:id', isAuthenticated, async (req, res) => {
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const post = await db.get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (post && post.username !== user.username) {
        await db.run('INSERT INTO collected (postId, userId) VALUES (?, ?)', [req.params.id, req.session.userId]);
    }
    res.redirect('/');
});

app.post('/delete/:id', isAuthenticated, async (req, res) => {
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const post = await db.get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (post && post.username === user.username) {
        await db.run('DELETE FROM posts WHERE id = ?', [req.params.id]);
    }
    res.redirect('/profile');
});

app.post('/delete-comment/:id', isAuthenticated, async (req, res) => {
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const comment = await db.get('SELECT * FROM comments WHERE id = ?', [req.params.id]);
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    if (comment && comment.username === user.username) {
        await db.run('DELETE FROM comments WHERE id = ?', [req.params.id]);
    }
    res.redirect('/');
});

app.post('/delete-collection/:id', isAuthenticated, async (req, res) => {
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    await db.run('DELETE FROM collected WHERE postId = ? AND userId = ?', [req.params.id, req.session.userId]);
    res.redirect('/profile');
});

app.post('/comment/:postId', isAuthenticated, async (req, res) => {
    const { content } = req.body;
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const user = await db.get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
    await db.run('INSERT INTO comments (postId, username, content, timestamp) VALUES (?, ?, ?, ?)', [req.params.postId, user.username, content, new Date().toISOString()]);
    res.redirect('/');
});

// Google OAuth routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    async (req, res) => {
        const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
        let user = await db.get('SELECT * FROM users WHERE hashedGoogleId = ?', [req.user.id]);
        if (!user) {
            await db.run('INSERT INTO users (username, hashedGoogleId, memberSince) VALUES (?, ?, ?)', [req.user.displayName, req.user.id, new Date().toISOString()]);
            user = await db.get('SELECT * FROM users WHERE hashedGoogleId = ?', [req.user.id]);
        }
        req.session.userId = user.id;
        req.session.loggedIn = true;
        res.redirect('/');
    }
);

// Username registration route after Google login
app.get('/registerUsername', (req, res) => {
    if (!req.session.passport || !req.session.passport.user) {
        return res.redirect('/login');
    }
    res.render('registerUsername', { appName: 'BlueBird' });
});

app.post('/registerUsername', async (req, res) => {
    if (!req.session.passport || !req.session.passport.user) {
        return res.redirect('/login');
    }
    const { username } = req.body;
    const db = await sqlite.open({ filename: 'microblog.db', driver: sqlite3.Database });
    const existingUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (existingUser) {
        return res.redirect('/registerUsername?error=Username already taken');
    }
    const hashedGoogleId = req.session.passport.user.id;
    await db.run('INSERT INTO users (username, hashedGoogleId, memberSince) VALUES (?, ?, ?)', [username, hashedGoogleId, new Date().toISOString()]);
    const newUser = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    req.session.userId = newUser.id;
    req.session.loggedIn = true;
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

function generateAvatar(letter, width = 100, height = 100) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    context.fillStyle = '#007BFF';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#FFFFFF';
    context.font = '50px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(letter, width / 2, height / 2);
    return canvas.toBuffer();
}

function isAuthenticated(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}
