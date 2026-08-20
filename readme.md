# Arian Farhadi — Portfolio

My personal portfolio website: an interactive 3D room you can explore, with a
working retro computer at its centre.

This is a fork of [Henry Heffernan's portfolio](https://github.com/henryjeff/portfolio)
(<a href="https://henryheffernan.com/"><samp>henryheffernan.com</samp></a>), adapted
for my own use. The original 3D scene, models and baked textures are his work —
all credit for the design goes to him. See `LICENSE.md`.

The computer screen renders a second, separate "2D OS" project inside an iframe.
Upstream that is [portfolio-inner-site](https://github.com/henryjeff/portfolio-inner-site);
until I fork and deploy my own, the screen still loads Henry's.

<br>

To setup a dev environment:

```bash
# Clone the repository

# Install dependencies
npm i

# Run the local dev server
npm run dev
```

To serve a production build:

```bash
# Install dependencies if not already done - 'npm i'

# Build for production
npm run build

# Serve the build using express
npm start
```

The production build is fully static (it lands in `public/`), so it can be hosted
on any static host. `vercel.json` configures the build for Vercel.
