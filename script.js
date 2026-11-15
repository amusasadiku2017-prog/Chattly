// CHATTLY FIREBASE CONFIGURATION
// Replace these values with your Firebase web app configuration.

const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let isRegistering = true;
let activeChat = null;
let messageListener = null;
let chatsListener = null;
let searchTimer = null;


// AUTHENTICATION

function toggleAuth() {
    isRegistering = !isRegistering;

    document.getElementById("registerFields").classList.toggle(
        "hidden", !isRegistering
    );

    document.getElementById("authButton").textContent =
        isRegistering ? "Create Account" : "Login";

    document.getElementById("switchText").textContent =
        isRegistering ? "Already have an account?" : "New to CHATTLY?";

    document.getElementById("switchButton").textContent =
        isRegistering ? "Login" : "Register";

    document.getElementById("authMessage").textContent = "";
}


async function authenticate() {

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const message = document.getElementById("authMessage");

    message.textContent = "";

    if (!email || !password) {
        message.textContent = "Enter your email and password.";
        return;
    }

    try {

        if (isRegistering) {

            const name = document.getElementById("displayName").value.trim();

            const username = document.getElementById("username")
                .value.trim().toLowerCase();

            if (!name || !username) {
                message.textContent = "Complete your profile.";
                return;
            }

            if (!/^[a-z0-9_]{3,20}$/.test(username)) {
                message.textContent =
                    "Username must be 3-20 letters, numbers or underscores.";
                return;
            }

            if (password.length < 8) {
                message.textContent =
                    "Use a password of at least 8 characters.";
                return;
            }

            const credential = await auth.createUserWithEmailAndPassword(
                email, password
            );

            const uid = credential.user.uid;

            await db.runTransaction(async transaction => {

                const usernameRef = db.collection("usernames").doc(username);

                const existing = await transaction.get(usernameRef);

                if (existing.exists) {
                    throw new Error("USERNAME_TAKEN");
                }

                transaction.set(usernameRef, {
                    uid: uid
                });

                transaction.set(db.collection("users").doc(uid), {
                    uid: uid,
                    displayName: name,
                    username: username,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });

            });

        } else {

            await auth.signInWithEmailAndPassword(email, password);

        }

    } catch (error) {

        if (error.message === "USERNAME_TAKEN") {
            message.textContent = "That username is already taken.";
        } else {
            message.textContent = friendlyError(error);
        }

    }
}


function friendlyError(error) {
    const messages = {
        "auth/invalid-email": "Enter a valid email address.",
        "auth/user-not-found": "Account not found.",
        "auth/wrong-password": "Incorrect login details.",
        "auth/invalid-credential": "Incorrect email or password.",
        "auth/email-already-in-use": "This email already has an account.",
        "auth/weak-password": "Choose a stronger password.",
        "auth/too-many-requests": "Too many attempts. Try again later."
    };

    return messages[error.code] || error.message;
}


// SESSION

auth.onAuthStateChanged(async user => {

    if (!user) {

        currentUser = null;

        document.getElementById("authScreen").classList.remove("hidden");
        document.getElementById("app").classList.add("hidden");

        stopListeners();

        return;
    }

    try {

        const profile = await db.collection("users").doc(user.uid).get();

        if (!profile.exists) {
            await auth.signOut();
            throw new Error("Account profile is unavailable.");
        }

        currentUser = profile.data();

        document.getElementById("authScreen").classList.add("hidden");
        document.getElementById("app").classList.remove("hidden");

        document.getElementById("welcome").textContent =
            "Welcome, " + currentUser.displayName;

        loadChats();

    } catch (error) {
        showToast(error.message);
    }

});


async function logout() {

    stopListeners();

    await auth.signOut();

    backHome();

}


function stopListeners() {

    if (messageListener) {
        messageListener();
        messageListener = null;
    }

    if (chatsListener) {
        chatsListener();
        chatsListener = null;
    }

}


// USER SEARCH

function searchUsers() {

    clearTimeout(searchTimer);

    searchTimer = setTimeout(findUsers, 400);

}


async function findUsers() {

    if (!currentUser) return;

    const term = document.getElementById("userSearch")
        .value.trim().toLowerCase();

    const results = document.getElementById("searchResults");

    results.innerHTML = "";

    if (term.length < 3) return;

    try {

        const usernameDoc = await db.collection("usernames")
            .doc(term).get();

        if (!usernameDoc.exists) {
            results.textContent = "No user found.";
            return;
        }

        const uid = usernameDoc.data().uid;

        if (uid === currentUser.uid) {
            results.textContent = "That's your own username.";
            return;
        }

        const userDoc = await db.collection("users").doc(uid).get();

        if (!userDoc.exists) return;

        const person = userDoc.data();

        const button = document.createElement("button");

        button.className = "user-result";
        button.textContent =
            person.displayName + "  @" + person.username;

        button.onclick = () => openChat(person);

        results.appendChild(button);

    } catch (error) {

        showToast(error.message);

    }

}


function searchUsers() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(findUsers, 400);
}


// CONVERSATIONS

function getChatId(uid1, uid2) {
    return [uid1, uid2].sort().join("_");
}


async function openChat(person) {

    try {

        const chatId = getChatId(currentUser.uid, person.uid);

        const chatRef = db.collection("chats").doc(chatId);

        const existing = await chatRef.get();

        if (!existing.exists) {

            await chatRef.set({
                members: [currentUser.uid, person.uid].sort(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                lastMessage: ""
            });

        }

        activeChat = chatId;

        document.getElementById("home").classList.add("hidden");

        document.getElementById("conversation").classList.remove("hidden");

        document.getElementById("chatName").textContent =
            person.displayName;

        loadMessages(chatId);

    } catch (error) {

        showToast(error.message);

    }

}


function loadChats() {

    if (chatsListener) chatsListener();

    chatsListener = db.collection("chats")
        .where("members", "array-contains", currentUser.uid)
        .onSnapshot(async snapshot => {

            const list = document.getElementById("chatList");

            list.innerHTML = "";

            for (const doc of snapshot.docs) {

                const chat = doc.data();

                const otherUid = chat.members.find(
                    uid => uid !== currentUser.uid
                );

                if (!otherUid) continue;

                const person = await db.collection("users")
                    .doc(otherUid).get();

                if (!person.exists) continue;

                const data = person.data();

                const item = document.createElement("div");

                item.className = "chat-item";

                const avatar = document.createElement("div");
                avatar.className = "avatar";
                avatar.textContent = data.displayName[0].toUpperCase();

                const info = document.createElement("div");

                const title = document.createElement("strong");
                title.textContent = data.displayName;

                const preview = document.createElement("p");
                preview.textContent = chat.lastMessage || "Start chatting";

                info.append(title, preview);
                item.append(avatar, info);

                item.onclick = () => openChat(data);

                list.appendChild(item);

            }

        }, error => showToast(error.message));

}


// MESSAGES

function loadMessages(chatId) {

    if (messageListener) messageListener();

    const list = document.getElementById("messages");

    list.innerHTML = "";

    messageListener = db.collection("chats")
        .doc(chatId)
        .collection("messages")
        .orderBy("createdAt")
        .onSnapshot(snapshot => {

            list.innerHTML = "";

            snapshot.forEach(doc => {

                const data = doc.data();

                const bubble = document.createElement("div");

                bubble.className = "message " +
                    (data.senderId === currentUser.uid
                        ? "my-message" : "");

                const text = document.createElement("div");

                text.textContent = data.text;

                bubble.appendChild(text);

                list.appendChild(bubble);

            });

            list.scrollTop = list.scrollHeight;

        }, error => showToast(error.message));

}


async function sendMessage() {

    const input = document.getElementById("messageInput");

    const text = input.value.trim();

    if (!text || !activeChat) return;

    if (text.length > 4000) {
        showToast("Message is too long.");
        return;
    }

    input.disabled = true;

    try {

        const chatRef = db.collection("chats").doc(activeChat);

        const chat = await chatRef.get();

        if (!chat.exists ||
            !chat.data().members.includes(currentUser.uid)) {
            throw new Error("You cannot access this conversation.");
        }

        const message = {
            senderId: currentUser.uid,
            text: text,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        const batch = db.batch();

        const messageRef = chatRef.collection("messages").doc();

        batch.set(messageRef, message);

        batch.update(chatRef, {
            lastMessage: text,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        await batch.commit();

        input.value = "";

    } catch (error) {

        showToast(error.message);

    } finally {

        input.disabled = false;

    }

}


document.getElementById("messageInput")
    .addEventListener("keydown", event => {

        if (event.key === "Enter") sendMessage();

    });


// NAVIGATION

function backHome() {

    if (messageListener) {
        messageListener();
        messageListener = null;
    }

    activeChat = null;

    document.getElementById("conversation").classList.add("hidden");

    document.getElementById("home").classList.remove("hidden");

}


function showComingSoon(name) {
    showToast(name + " will be activated in a later development stage.");
}


function showToast(message) {

    const toast = document.getElementById("toast");

    toast.textContent = message;

    toast.style.display = "block";

    setTimeout(() => {
        toast.style.display = "none";
    }, 3000);

  }
