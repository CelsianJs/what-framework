# Page snapshot

```yaml
- main [ref=e4]:
  - generic [ref=e6]:
    - heading "Project Task Manager" [level=1] [ref=e7]
    - textbox "Search tasks..." [ref=e8]
    - generic [ref=e9]:
      - generic [ref=e10]:
        - generic [ref=e11]: "Filter:"
        - button "All" [ref=e12] [cursor=pointer]
        - button "Active" [ref=e13] [cursor=pointer]
        - button "Done" [ref=e14] [cursor=pointer]
      - generic [ref=e15]:
        - generic [ref=e16]: "Sort:"
        - button "Date" [ref=e17] [cursor=pointer]
        - button "Priority" [ref=e18] [cursor=pointer]
  - generic [ref=e20]:
    - textbox "What needs to be done?" [ref=e21]
    - combobox [ref=e22] [cursor=pointer]:
      - option "Low"
      - option "Medium" [selected]
      - option "High"
    - button "Add Task" [active] [ref=e23] [cursor=pointer]
  - list [ref=e25]:
    - listitem [ref=e26]: No tasks match your criteria.
  - generic [ref=e29]: 00active /0done /total
```