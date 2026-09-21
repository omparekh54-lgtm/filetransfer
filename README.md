# Filetransfer

A no-account large-file transfer app. Senders upload files or folders, choose an expiry of up to seven days, and share a six-digit code. Receivers enter the code to get short-lived signed download links.

## Architecture

- Next.js App Router on Vercel
- Direct multipart browser uploads to a private Vercel Blob store
- Small transfer manifests stored privately in the same Blob store
- Six-digit active transfer codes, hashed owner deletion tokens, logical expiry and daily physical cleanup
- No file bytes pass through a Vercel Function

## Local setup

1. Install dependencies with `npm install`.
2. Create a **private** Vercel Blob store and connect it to the project.
3. Run `vercel env pull .env.local`, or copy `.env.example` to `.env.local` and set the values.
4. Run `npm run dev`.

## Limits

- 20 GB per file
- 50 GB per transfer
- 500 files per transfer
- 7-day maximum expiry

Limits live in `lib/constants.ts` and can be changed independently of the UI.
