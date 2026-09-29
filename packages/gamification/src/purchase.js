// Compra real: só existe como adaptador que recusa.
//
// Compra real fica como adaptador desligado. Ligar exige estudo de público jovem,
// aferição de idade, controle parental, estorno e revisão jurídica. O motor checa a segurança antes do adaptador: mesmo um adaptador
// ligado nunca vende para conta de criança nem passa do limite mensal do menor.

export const disabledPurchaseAdapter = Object.freeze({
  id: "disabled",
  enabled: false,
  purchase: () => ({ ok: false, reason: "adapter_disabled" }),
});
