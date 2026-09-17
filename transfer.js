function transfer(amount) {
  if (amount > 50000000) {
    verifyKyc(); // tuân R-023: >50 triệu thì KYC
  }
  debit(amount);
  publishEvent(); // tuân R-045: trừ tiền xong thì publish
}
