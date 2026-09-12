function loginAdmin() {
    const email    = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    if (!email || !password) {
        alert("Please enter your email and password.");
        return;
    }

    auth.signInWithEmailAndPassword(email, password)
        .then(cred => db.collection("users").doc(cred.user.uid).get())
        .then(snap => {
            const role = snap.exists ? (snap.data().role || "student") : "student";
            if (role !== "admin") {
                return auth.signOut().then(() => {
                    alert("This login is for admins only.");
                });
            }
            window.location.href = "admin.html";
        })
        .catch(error => alert(error.message));
}
