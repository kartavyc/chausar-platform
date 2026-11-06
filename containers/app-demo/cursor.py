#!/usr/bin/python3
"""A visible, input-transparent agent marker, separate from the owner's pointer."""
import ctypes
import json
import tkinter as tk

root = tk.Tk()
root.overrideredirect(True)
root.attributes('-topmost', True)
label = tk.Label(root, text='Chausar agent', bg='#513588', fg='#ffffff', font=('DejaVu Sans', 12, 'bold'), padx=9, pady=5)
label.pack()
root.update_idletasks()
x11 = ctypes.CDLL('libX11.so.6')
fixes = ctypes.CDLL('libXfixes.so.3')
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = ctypes.c_void_p
display = x11.XOpenDisplay(b':99')
if not display:
    raise RuntimeError('The private display is unavailable.')
fixes.XFixesCreateRegion.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int]
fixes.XFixesCreateRegion.restype = ctypes.c_ulong
fixes.XFixesSetWindowShapeRegion.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
fixes.XFixesDestroyRegion.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x11.XFlush.argtypes = [ctypes.c_void_p]
x11.XQueryTree.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(ctypes.c_uint)]
x11.XFree.argtypes = [ctypes.c_void_p]
region = fixes.XFixesCreateRegion(display, None, 0)
window = root.winfo_id()
parent, tree_root, children, count = ctypes.c_ulong(), ctypes.c_ulong(), ctypes.c_void_p(), ctypes.c_uint()
x11.XQueryTree(display, window, ctypes.byref(tree_root), ctypes.byref(parent), ctypes.byref(children), ctypes.byref(count))
for target in {window, parent.value}:
    if target and target != tree_root.value:
        fixes.XFixesSetWindowShapeRegion(display, target, 2, 0, 0, region)
fixes.XFixesDestroyRegion(display, region)
if children:
    x11.XFree(children)
x11.XFlush(display)

def update():
    with open('/tmp/chausar-demo/cursor.json', encoding='utf8') as source:
        point = json.load(source)
    x, y = point['x'], point['y']
    if type(x) is not int or type(y) is not int or not 0 <= x < 1280 or not 0 <= y < 720:
        raise RuntimeError('The agent marker is invalid.')
    root.geometry('+{}+{}'.format(min(x + 18, 1280 - root.winfo_reqwidth()), min(y + 18, 720 - root.winfo_reqheight())))
    root.lift()
    root.after(50, update)

update()
root.mainloop()
