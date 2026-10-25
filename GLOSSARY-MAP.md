# Glossary Map

## Contexts

- [通用](./GLOSSARY.md): pi 扩展开发的通用概念（扩展、技能、包、工具、命令、会话等），全仓库共享
- [nmem](./packages/nmem/GLOSSARY.md): nmem 集成的共用术语（nmem 后端、ambient sync、快照、刚性/防抖 flush、引导注入等），`@cnife/pi-nmem` 与 `personal/nmem-lite` 两个实现共用
- [thinking-fold](./personal/thinking-fold/GLOSSARY.md): `personal/thinking-fold` 扩展的折叠渲染术语（折叠位移、高度留白、高度债）

## Relationships

- **nmem → 通用**：nmem 集成（产品包 `@cnife/pi-nmem` 与 personal 层 `nmem-lite`）遵循通用的扩展/包/工具概念；nmem 特有术语独立维护在 `packages/nmem/GLOSSARY.md`
- **thinking-fold → 通用**：thinking-fold 是 personal 层扩展，遵循通用的扩展概念；折叠渲染术语独立维护在 `personal/thinking-fold/GLOSSARY.md`
