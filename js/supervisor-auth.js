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

document.getElementById("forgotPasswordLink").addEventListener("click", function (e) {
  e.preventDefault();

  var email = document.getElementById("loginEmail").value;

  if (!email) {
    alert("Please type your email into the Email Address box first, then click Forgot Password.");
    return;
  }

  firebase.auth().sendPasswordResetEmail(email)
    .then(function () {
      alert("A password reset link has been sent to " + email + ". Please check your inbox.");
    })
    .catch(function (error) {
      console.error(error);
      alert("Couldn't send reset email: " + error.message);
    });
});