# TKD — Number Sequence (Blueprint)

## Tujuan
Membuat 1 soal Number Sequence bergaya BUMN dengan 5 opsi jawaban (A–E).

## Format Soal
- Stem berisi deret angka dengan satu angka yang salah di antara tanda garis (|).
- Instruksi jelas: tentukan angka yang tidak sesuai pola.
- Opsi berisi 5 angka kandidat (A–E).

## Struktur Output (JSON)
```json
{
  "question": "....",
  "options": ["..", "..", "..", "..", ".."],
  "correctAnswer": "A|B|C|D|E",
  "explanation": "..."
}
```

## Aturan Kualitas
- Pola harus konsisten dan dapat dijelaskan.
- Pembahasan menjelaskan pola langkah demi langkah.
- Pastikan hanya 1 opsi yang salah.
