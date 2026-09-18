// Luồng chuyển tiền - có lỗi nghiệp vụ chủ đích để test agent

function transfer(fromUser, toUser, amount) {
  // Kiểm tra số dư
  const balance = getBalance(fromUser);
  if (balance < amount) {
    throw new Error("Số dư không đủ");
  }

  // Trừ tiền tài khoản nguồn
  debit(fromUser, amount);

  // Cộng tiền tài khoản đích
  credit(toUser, amount);

  return { status: "success", amount };
}

function getBalance(user) {
  return db.query("SELECT balance FROM wallets WHERE user = ?", user);
}

function debit(user, amount) {
  db.query(
    "UPDATE wallets SET balance = balance - ? WHERE user = ?",
    amount,
    user,
  );
}

function credit(user, amount) {
  db.query(
    "UPDATE wallets SET balance = balance + ? WHERE user = ?",
    amount,
    user,
  );
}
