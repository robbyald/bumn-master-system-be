import { db } from "../src/db/index.js";
import { examPackage } from "../src/db/schema.js";

const packages = [
  {
    id: "PKG-00001",
    title: "Paket Simulasi BUMN Batch 1",
    description: "Simulasi lengkap TKD, AKHLAK, dan Bahasa Inggris sesuai standar terbaru.",
    price: 0,
    durationMinutes: 60,
    categories: JSON.stringify(["TKD", "AKHLAK", "ENGLISH"]),
    totalQuestions: 40,
    type: "tryout",
    isPopular: false,
    educationLevel: "ALL"
  },
  {
    id: "PKG-00002",
    title: "Premium Master Class BUMN",
    description: "Paket intensif dengan pembahasan video dan prediksi soal akurat.",
    price: 149000,
    durationMinutes: 120,
    categories: JSON.stringify(["TKD", "AKHLAK", "ENGLISH", "BIDANG"]),
    totalQuestions: 100,
    type: "tryout",
    isPopular: true,
    educationLevel: "D3-S2"
  },
  {
    id: "PKG-00003",
    title: "E-Book Strategi Lolos BUMN",
    description: "Panduan lengkap cara menjawab soal TKD dan AKHLAK dengan cepat.",
    price: 49000,
    durationMinutes: 0,
    categories: JSON.stringify(["STRATEGY", "TIPS"]),
    totalQuestions: 0,
    type: "learning",
    isPopular: false,
    educationLevel: "ALL"
  },
  {
    id: "PKG-00004",
    title: "Video Course AKHLAK & Core Values",
    description: "Penjelasan mendalam tentang Core Values BUMN oleh mentor ahli.",
    price: 99000,
    durationMinutes: 180,
    categories: JSON.stringify(["AKHLAK"]),
    totalQuestions: 0,
    type: "learning",
    isPopular: true,
    educationLevel: "ALL"
  },
  {
    id: "PKG-00005",
    title: "TKB IT & Teknologi Digital",
    description: "Persiapan Tes Kemampuan Bidang khusus posisi IT, Software Engineer, dan Data.",
    price: 125000,
    durationMinutes: 90,
    categories: JSON.stringify(["TKB", "IT"]),
    totalQuestions: 50,
    type: "tryout",
    isPopular: false,
    educationLevel: "D3-S2"
  },
  {
    id: "PKG-00006",
    title: "Spesialis Seleksi PT Pertamina",
    description: "Paket intensif khusus untuk persiapan rekrutmen PT Pertamina (Persero).",
    price: 159000,
    durationMinutes: 150,
    categories: JSON.stringify(["PERTAMINA", "TKD", "AKHLAK"]),
    totalQuestions: 120,
    type: "tryout",
    isPopular: true,
    educationLevel: "ALL"
  },
  {
    id: "PKG-00007",
    title: "Mastering Bahasa Inggris BUMN (Tahap 2)",
    description: "Fokus pada struktur soal Bahasa Inggris standar RBB BUMN Tahap 2.",
    price: 89000,
    durationMinutes: 60,
    categories: JSON.stringify(["ENGLISH", "TAHAP 2"]),
    totalQuestions: 50,
    type: "tryout",
    isPopular: false,
    educationLevel: "ALL"
  }
];

async function main() {
  for (const pkg of packages) {
    await db
      .insert(examPackage)
      .values(pkg)
      .onConflictDoUpdate({
        target: examPackage.id,
        set: { ...pkg }
      });
  }
  // eslint-disable-next-line no-console
  console.log("Seeded packages:", packages.length);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
