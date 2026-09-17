function transfer(amount) {
  if (amount > 50000000) {
    verifyKyc();
  }
  debit(amount);
  publishEvent();
}
