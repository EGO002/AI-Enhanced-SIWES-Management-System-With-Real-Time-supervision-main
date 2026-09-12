function loginSupervisor() {
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
            if (role !== "supervisor") {
                return auth.signOut().then(() => {
                    alert("This login is for supervisors only. Please use the correct portal for your account.");
                });
            }
            window.location.href = "supervisor-dashboard.html";
        })
        .catch(error => alert(error.message));
}
