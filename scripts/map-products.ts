// One-off: link Firestore products to PrestaShop by reference.
// Same as the "Re-map products" button, handy for the first setup.
import { PrestaShop } from "../lib/prestashop";
import { mapProducts } from "../lib/sync";

mapProducts(PrestaShop.fromEnv()).then(
  (r) => { console.log(r); process.exit(0); },
  (e) => { console.error(e); process.exit(1); },
);
