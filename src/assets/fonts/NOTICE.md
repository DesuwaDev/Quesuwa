# reactions.woff2

A subset of the Twemoji COLR font holding only the quick-reaction emoji (❤️ 👍 😆 😮 👏 🎊 🤗 🫪),
so they look the same on every system.

- Emoji art: [Twemoji](https://github.com/jdecked/twemoji) 17.0.2, © Twitter, Inc. and other contributors,
  licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Font build: [@sableclient/twemoji-font](https://github.com/SableClient/twemoji-font) 1.0.4
  (from Mozilla's twemoji-colr), licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0).

Made with fontTools:

```sh
pyftsubset twemoji.woff2 --unicodes="U+2764,U+FE0F,U+1F44D,U+1F606,U+1F62E,U+1F44F,U+1F38A,U+1F917,U+1FAEA" \
  --layout-features='*' --flavor=woff2 --output-file=reactions.woff2
```

When changing `REACTIONS` in `shared/reactions.js`, rebuild this file with the new code points and
update the `unicode-range` in `src/styles/reactions.css`.
