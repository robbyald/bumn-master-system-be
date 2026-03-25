# TKD — Word Classification (Blueprint)

## Tujuan
Membuat 1 soal klasifikasi kata (odd one out) bergaya BUMN dengan 5 opsi jawaban (A–E).

## Format Soal
- Stem berisi instruksi memilih kata yang tidak memiliki kesamaan dengan yang lain.
- Opsi 5 kata (A–E).
- Satu opsi harus berbeda secara jelas berdasarkan satu kriteria.

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
- Kategori pembeda harus konsisten dan jelas.
- Pembahasan menjelaskan alasan perbedaan secara singkat dan tepat.
- Hindari ambiguitas makna.
- Opsi jawaban TIDAK boleh ditulis di dalam stem/pertanyaan.
