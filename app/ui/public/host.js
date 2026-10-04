//#region \0rolldown/runtime.js
var e = Object.create, t = Object.defineProperty, n = Object.getOwnPropertyDescriptor, r = Object.getOwnPropertyNames, i = Object.getPrototypeOf, a = Object.prototype.hasOwnProperty, o = (e, t) => () => (t || (e((t = { exports: {} }).exports, t), e = null), t.exports), s = (e, i, o, s) => {
	if (i && typeof i == "object" || typeof i == "function") for (var c = r(i), l = 0, u = c.length, d; l < u; l++) d = c[l], !a.call(e, d) && d !== o && t(e, d, {
		get: ((e) => i[e]).bind(null, d),
		enumerable: !(s = n(i, d)) || s.enumerable
	});
	return e;
}, c = (n, r, o) => (o = n == null ? {} : e(i(n)), s(r || !n || !n.__esModule || !a.call(n, "default") ? t(o, "default", {
	value: n,
	enumerable: !0
}) : o, n)), l = /* @__PURE__ */ o(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.portal"), r = Symbol.for("react.fragment"), i = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), o = Symbol.for("react.consumer"), s = Symbol.for("react.context"), c = Symbol.for("react.forward_ref"), l = Symbol.for("react.suspense"), u = Symbol.for("react.memo"), d = Symbol.for("react.lazy"), f = Symbol.for("react.activity"), p = Symbol.for("react.view_transition"), m = Symbol.iterator;
	function h(e) {
		return typeof e != "object" || !e ? null : (e = m && e[m] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var g = {
		isMounted: function() {
			return !1;
		},
		enqueueForceUpdate: function() {},
		enqueueReplaceState: function() {},
		enqueueSetState: function() {}
	}, _ = Object.assign, v = {};
	function y(e, t, n) {
		this.props = e, this.context = t, this.refs = v, this.updater = n || g;
	}
	y.prototype.isReactComponent = {}, y.prototype.setState = function(e, t) {
		if (typeof e != "object" && typeof e != "function" && e != null) throw Error("takes an object of state variables to update or a function which returns an object of state variables.");
		this.updater.enqueueSetState(this, e, t, "setState");
	}, y.prototype.forceUpdate = function(e) {
		this.updater.enqueueForceUpdate(this, e, "forceUpdate");
	};
	function b() {}
	b.prototype = y.prototype;
	function x(e, t, n) {
		this.props = e, this.context = t, this.refs = v, this.updater = n || g;
	}
	var S = x.prototype = new b();
	S.constructor = x, _(S, y.prototype), S.isPureReactComponent = !0;
	var C = Array.isArray;
	function w() {}
	var T = {
		H: null,
		A: null,
		T: null,
		S: null
	}, ee = Object.prototype.hasOwnProperty;
	function E(e, n, r) {
		var i = r.ref;
		return {
			$$typeof: t,
			type: e,
			key: n,
			ref: i === void 0 ? null : i,
			props: r
		};
	}
	function te(e, t) {
		return E(e.type, t, e.props);
	}
	function D(e) {
		return typeof e == "object" && !!e && e.$$typeof === t;
	}
	function O(e) {
		var t = {
			"=": "=0",
			":": "=2"
		};
		return "$" + e.replace(/[=:]/g, function(e) {
			return t[e];
		});
	}
	var ne = /\/+/g;
	function re(e, t) {
		return typeof e == "object" && e && e.key != null ? O("" + e.key) : t.toString(36);
	}
	function ie(e) {
		switch (e.status) {
			case "fulfilled": return e.value;
			case "rejected": throw e.reason;
			default: switch (typeof e.status == "string" ? e.then(w, w) : (e.status = "pending", e.then(function(t) {
				e.status === "pending" && (e.status = "fulfilled", e.value = t);
			}, function(t) {
				e.status === "pending" && (e.status = "rejected", e.reason = t);
			})), e.status) {
				case "fulfilled": return e.value;
				case "rejected": throw e.reason;
			}
		}
		throw e;
	}
	function ae(e, r, i, a, o) {
		var s = typeof e;
		(s === "undefined" || s === "boolean") && (e = null);
		var c = !1;
		if (e === null) c = !0;
		else switch (s) {
			case "bigint":
			case "string":
			case "number":
				c = !0;
				break;
			case "object": switch (e.$$typeof) {
				case t:
				case n:
					c = !0;
					break;
				case d: return c = e._init, ae(c(e._payload), r, i, a, o);
			}
		}
		if (c) return o = o(e), c = a === "" ? "." + re(e, 0) : a, C(o) ? (i = "", c != null && (i = c.replace(ne, "$&/") + "/"), ae(o, r, i, "", function(e) {
			return e;
		})) : o != null && (D(o) && (o = te(o, i + (o.key == null || e && e.key === o.key ? "" : ("" + o.key).replace(ne, "$&/") + "/") + c)), r.push(o)), 1;
		c = 0;
		var l = a === "" ? "." : a + ":";
		if (C(e)) for (var u = 0; u < e.length; u++) a = e[u], s = l + re(a, u), c += ae(a, r, i, s, o);
		else if (u = h(e), typeof u == "function") for (e = u.call(e), u = 0; !(a = e.next()).done;) a = a.value, s = l + re(a, u++), c += ae(a, r, i, s, o);
		else if (s === "object") {
			if (typeof e.then == "function") return ae(ie(e), r, i, a, o);
			throw r = String(e), Error("Objects are not valid as a React child (found: " + (r === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : r) + "). If you meant to render a collection of children, use an array instead.");
		}
		return c;
	}
	function oe(e, t, n) {
		if (e == null) return e;
		var r = [], i = 0;
		return ae(e, r, "", "", function(e) {
			return t.call(n, e, i++);
		}), r;
	}
	function se(e) {
		if (e._status === -1) {
			var t = e._result, n = t();
			n.then(function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 1, e._result = t, n.status === void 0 && (n.status = "fulfilled", n.value = t));
			}, function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 2, e._result = t, n.status === void 0 && (n.status = "rejected", n.reason = t));
			}), e._status === -1 && (e._status = 0, e._result = n);
		}
		if (e._status === 1) return e._result.default;
		throw e._result;
	}
	var ce = typeof reportError == "function" ? reportError : function(e) {
		if (typeof window == "object" && typeof window.ErrorEvent == "function") {
			var t = new window.ErrorEvent("error", {
				bubbles: !0,
				cancelable: !0,
				message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
				error: e
			});
			if (!window.dispatchEvent(t)) return;
		} else if (typeof process == "object" && typeof process.emit == "function") {
			process.emit("uncaughtException", e);
			return;
		}
		console.error(e);
	};
	function le(e) {
		var t = T.T, n = {};
		n.types = t === null ? null : t.types, T.T = n;
		try {
			var r = e(), i = T.S;
			i !== null && i(n, r), typeof r == "object" && r && typeof r.then == "function" && r.then(w, ce);
		} catch (e) {
			ce(e);
		} finally {
			t !== null && n.types !== null && (t.types = n.types), T.T = t;
		}
	}
	function ue(e) {
		var t = T.T;
		if (t !== null) {
			var n = t.types;
			n === null ? t.types = [e] : n.indexOf(e) === -1 && n.push(e);
		} else le(ue.bind(null, e));
	}
	var de = {
		map: oe,
		forEach: function(e, t, n) {
			oe(e, function() {
				t.apply(this, arguments);
			}, n);
		},
		count: function(e) {
			var t = 0;
			return oe(e, function() {
				t++;
			}), t;
		},
		toArray: function(e) {
			return oe(e, function(e) {
				return e;
			}) || [];
		},
		only: function(e) {
			if (!D(e)) throw Error("React.Children.only expected to receive a single React element child.");
			return e;
		}
	};
	e.Activity = f, e.Children = de, e.Component = y, e.Fragment = r, e.Profiler = a, e.PureComponent = x, e.StrictMode = i, e.Suspense = l, e.ViewTransition = p, e.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = T, e.__COMPILER_RUNTIME = {
		__proto__: null,
		c: function(e) {
			return T.H.useMemoCache(e);
		}
	}, e.addTransitionType = ue, e.cache = function(e) {
		return function() {
			return e.apply(null, arguments);
		};
	}, e.cacheSignal = function() {
		return null;
	}, e.cloneElement = function(e, t, n) {
		if (e == null) throw Error("The argument must be a React element, but you passed " + e + ".");
		var r = _({}, e.props), i = e.key;
		if (t != null) for (a in t.key !== void 0 && (i = "" + t.key), t) !ee.call(t, a) || a === "key" || a === "__self" || a === "__source" || a === "ref" && t.ref === void 0 || (r[a] = t[a]);
		var a = arguments.length - 2;
		if (a === 1) r.children = n;
		else if (1 < a) {
			for (var o = Array(a), s = 0; s < a; s++) o[s] = arguments[s + 2];
			r.children = o;
		}
		return E(e.type, i, r);
	}, e.createContext = function(e) {
		return e = {
			$$typeof: s,
			_currentValue: e,
			_currentValue2: e,
			_threadCount: 0,
			Provider: null,
			Consumer: null
		}, e.Provider = e, e.Consumer = {
			$$typeof: o,
			_context: e
		}, e;
	}, e.createElement = function(e, t, n) {
		var r, i = {}, a = null;
		if (t != null) for (r in t.key !== void 0 && (a = "" + t.key), t) ee.call(t, r) && r !== "key" && r !== "__self" && r !== "__source" && (i[r] = t[r]);
		var o = arguments.length - 2;
		if (o === 1) i.children = n;
		else if (1 < o) {
			for (var s = Array(o), c = 0; c < o; c++) s[c] = arguments[c + 2];
			i.children = s;
		}
		if (e && e.defaultProps) for (r in o = e.defaultProps, o) i[r] === void 0 && (i[r] = o[r]);
		return E(e, a, i);
	}, e.createRef = function() {
		return { current: null };
	}, e.forwardRef = function(e) {
		return {
			$$typeof: c,
			render: e
		};
	}, e.isValidElement = D, e.lazy = function(e) {
		return {
			$$typeof: d,
			_payload: {
				_status: -1,
				_result: e
			},
			_init: se
		};
	}, e.memo = function(e, t) {
		return {
			$$typeof: u,
			type: e,
			compare: t === void 0 ? null : t
		};
	}, e.startTransition = le, e.unstable_useCacheRefresh = function() {
		return T.H.useCacheRefresh();
	}, e.use = function(e) {
		return T.H.use(e);
	}, e.useActionState = function(e, t, n) {
		return T.H.useActionState(e, t, n);
	}, e.useCallback = function(e, t) {
		return T.H.useCallback(e, t);
	}, e.useContext = function(e) {
		return T.H.useContext(e);
	}, e.useDebugValue = function() {}, e.useDeferredValue = function(e, t) {
		return T.H.useDeferredValue(e, t);
	}, e.useEffect = function(e, t) {
		return T.H.useEffect(e, t);
	}, e.useEffectEvent = function(e) {
		return T.H.useEffectEvent(e);
	}, e.useId = function() {
		return T.H.useId();
	}, e.useImperativeHandle = function(e, t, n) {
		return T.H.useImperativeHandle(e, t, n);
	}, e.useInsertionEffect = function(e, t) {
		return T.H.useInsertionEffect(e, t);
	}, e.useLayoutEffect = function(e, t) {
		return T.H.useLayoutEffect(e, t);
	}, e.useMemo = function(e, t) {
		return T.H.useMemo(e, t);
	}, e.useOptimistic = function(e, t) {
		return T.H.useOptimistic(e, t);
	}, e.useReducer = function(e, t, n) {
		return T.H.useReducer(e, t, n);
	}, e.useRef = function(e) {
		return T.H.useRef(e);
	}, e.useState = function(e) {
		return T.H.useState(e);
	}, e.useSyncExternalStore = function(e, t, n) {
		return T.H.useSyncExternalStore(e, t, n);
	}, e.useTransition = function() {
		return T.H.useTransition();
	}, e.version = "19.3.0";
})), u = /* @__PURE__ */ o(((e, t) => {
	t.exports = l();
})), d = /* @__PURE__ */ o(((e) => {
	function t(e, t) {
		var n = e.length;
		e.push(t);
		a: for (; 0 < n;) {
			var r = n - 1 >>> 1, a = e[r];
			if (0 < i(a, t)) e[r] = t, e[n] = a, n = r;
			else break a;
		}
	}
	function n(e) {
		return e.length === 0 ? null : e[0];
	}
	function r(e) {
		if (e.length === 0) return null;
		var t = e[0], n = e.pop();
		if (n !== t) {
			e[0] = n;
			a: for (var r = 0, a = e.length, o = a >>> 1; r < o;) {
				var s = 2 * (r + 1) - 1, c = e[s], l = s + 1, u = e[l];
				if (0 > i(c, n)) l < a && 0 > i(u, c) ? (e[r] = u, e[l] = n, r = l) : (e[r] = c, e[s] = n, r = s);
				else if (l < a && 0 > i(u, n)) e[r] = u, e[l] = n, r = l;
				else break a;
			}
		}
		return t;
	}
	function i(e, t) {
		var n = e.sortIndex - t.sortIndex;
		return n === 0 ? e.id - t.id : n;
	}
	if (e.unstable_now = void 0, typeof performance == "object" && typeof performance.now == "function") {
		var a = performance;
		e.unstable_now = function() {
			return a.now();
		};
	} else {
		var o = Date, s = o.now();
		e.unstable_now = function() {
			return o.now() - s;
		};
	}
	var c = [], l = [], u = 1, d = null, f = 3, p = !1, m = !1, h = !1, g = !1, _ = typeof setTimeout == "function" ? setTimeout : null, v = typeof clearTimeout == "function" ? clearTimeout : null, y = typeof setImmediate < "u" ? setImmediate : null;
	function b(e) {
		for (var i = n(l); i !== null;) {
			if (i.callback === null) r(l);
			else if (i.startTime <= e) r(l), i.sortIndex = i.expirationTime, t(c, i);
			else break;
			i = n(l);
		}
	}
	function x(e) {
		if (h = !1, b(e), !m) {
			if (n(c) !== null) m = !0, S || (S = !0, te());
			else {
				var t = n(l);
				t !== null && ne(x, t.startTime - e);
			}
		}
	}
	var S = !1, C = -1, w = 5, T = -1;
	function ee() {
		return g ? !0 : !(e.unstable_now() - T < w);
	}
	function E() {
		if (g = !1, S) {
			var t = e.unstable_now();
			T = t;
			var i = !0;
			try {
				a: {
					m = !1, h && (h = !1, v(C), C = -1), p = !0;
					var a = f;
					try {
						b: {
							for (b(t), d = n(c); d !== null && !(d.expirationTime > t && ee());) {
								var o = d.callback;
								if (typeof o == "function") {
									d.callback = null, f = d.priorityLevel;
									var s = o(d.expirationTime <= t);
									if (t = e.unstable_now(), typeof s == "function") {
										d.callback = s, b(t), i = !0;
										break b;
									}
									d === n(c) && r(c), b(t);
								} else r(c);
								d = n(c);
							}
							if (d !== null) i = !0;
							else {
								var u = n(l);
								u !== null && ne(x, u.startTime - t), i = !1;
							}
						}
						break a;
					} finally {
						d = null, f = a, p = !1;
					}
					i = void 0;
				}
			} finally {
				i ? te() : S = !1;
			}
		}
	}
	var te;
	if (typeof y == "function") te = function() {
		y(E);
	};
	else if (typeof MessageChannel < "u") {
		var D = new MessageChannel(), O = D.port2;
		D.port1.onmessage = E, te = function() {
			O.postMessage(null);
		};
	} else te = function() {
		_(E, 0);
	};
	function ne(t, n) {
		C = _(function() {
			t(e.unstable_now());
		}, n);
	}
	e.unstable_IdlePriority = 5, e.unstable_ImmediatePriority = 1, e.unstable_LowPriority = 4, e.unstable_NormalPriority = 3, e.unstable_Profiling = null, e.unstable_UserBlockingPriority = 2, e.unstable_cancelCallback = function(e) {
		e.callback = null;
	}, e.unstable_forceFrameRate = function(e) {
		0 > e || 125 < e ? console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported") : w = 0 < e ? Math.floor(1e3 / e) : 5;
	}, e.unstable_getCurrentPriorityLevel = function() {
		return f;
	}, e.unstable_next = function(e) {
		switch (f) {
			case 1:
			case 2:
			case 3:
				var t = 3;
				break;
			default: t = f;
		}
		var n = f;
		f = t;
		try {
			return e();
		} finally {
			f = n;
		}
	}, e.unstable_requestPaint = function() {
		g = !0;
	}, e.unstable_runWithPriority = function(e, t) {
		switch (e) {
			case 1:
			case 2:
			case 3:
			case 4:
			case 5: break;
			default: e = 3;
		}
		var n = f;
		f = e;
		try {
			return t();
		} finally {
			f = n;
		}
	}, e.unstable_scheduleCallback = function(r, i, a) {
		var o = e.unstable_now();
		switch (typeof a == "object" && a ? (a = a.delay, a = typeof a == "number" && 0 < a ? o + a : o) : a = o, r) {
			case 1:
				var s = -1;
				break;
			case 2:
				s = 250;
				break;
			case 5:
				s = 1073741823;
				break;
			case 4:
				s = 1e4;
				break;
			default: s = 5e3;
		}
		return s = a + s, r = {
			id: u++,
			callback: i,
			priorityLevel: r,
			startTime: a,
			expirationTime: s,
			sortIndex: -1
		}, a > o ? (r.sortIndex = a, t(l, r), n(c) === null && r === n(l) && (h ? (v(C), C = -1) : h = !0, ne(x, a - o))) : (r.sortIndex = s, t(c, r), m || p || (m = !0, S || (S = !0, te()))), r;
	}, e.unstable_shouldYield = ee, e.unstable_wrapCallback = function(e) {
		var t = f;
		return function() {
			var n = f;
			f = t;
			try {
				return e.apply(this, arguments);
			} finally {
				f = n;
			}
		};
	};
})), f = /* @__PURE__ */ o(((e, t) => {
	t.exports = d();
})), p = /* @__PURE__ */ o(((e) => {
	var t = u();
	function n(e) {
		var t = "https://react.dev/errors/" + e;
		if (1 < arguments.length) {
			t += "?args[]=" + encodeURIComponent(arguments[1]);
			for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		}
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	function r() {}
	var i = {
		d: {
			f: r,
			r: function() {
				throw Error(n(522));
			},
			D: r,
			C: r,
			L: r,
			m: r,
			X: r,
			S: r,
			M: r
		},
		p: 0,
		findDOMNode: null
	}, a = Symbol.for("react.portal"), o = Symbol.for("react.recoverable"), s = Symbol.for("react.optimistic_key");
	function c(e, t, n) {
		var r = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
		return {
			$$typeof: a,
			key: r == null ? null : r === s ? s : "" + r,
			children: e,
			containerInfo: t,
			implementation: n
		};
	}
	var l = t.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
	function d(e, t) {
		if (e === "font") return "";
		if (typeof t == "string") return t === "use-credentials" ? t : "";
	}
	e.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = i, e.browser = function(e) {
		return {
			$$typeof: o,
			_reason: e
		};
	}, e.createPortal = function(e, t) {
		var r = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
		if (!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11) throw Error(n(299));
		return c(e, t, null, r);
	}, e.flushSync = function(e) {
		var t = l.T, n = i.p;
		try {
			if (l.T = null, i.p = 2, e) return e();
		} finally {
			l.T = t, i.p = n, i.d.f();
		}
	}, e.preconnect = function(e, t) {
		typeof e == "string" && (t ? (t = t.crossOrigin, t = typeof t == "string" ? t === "use-credentials" ? t : "" : void 0) : t = null, i.d.C(e, t));
	}, e.prefetchDNS = function(e) {
		typeof e == "string" && i.d.D(e);
	}, e.preinit = function(e, t) {
		if (typeof e == "string" && t && typeof t.as == "string") {
			var n = t.as, r = d(n, t.crossOrigin), a = typeof t.integrity == "string" ? t.integrity : void 0, o = typeof t.fetchPriority == "string" ? t.fetchPriority : void 0;
			n === "style" ? i.d.S(e, typeof t.precedence == "string" ? t.precedence : void 0, {
				crossOrigin: r,
				integrity: a,
				fetchPriority: o
			}) : n === "script" && i.d.X(e, {
				crossOrigin: r,
				integrity: a,
				fetchPriority: o,
				nonce: typeof t.nonce == "string" ? t.nonce : void 0
			});
		}
	}, e.preinitModule = function(e, t) {
		if (typeof e == "string") {
			if (typeof t == "object" && t) {
				if (t.as == null || t.as === "script") {
					var n = d(t.as, t.crossOrigin);
					i.d.M(e, {
						crossOrigin: n,
						integrity: typeof t.integrity == "string" ? t.integrity : void 0,
						nonce: typeof t.nonce == "string" ? t.nonce : void 0,
						fetchPriority: typeof t.fetchPriority == "string" ? t.fetchPriority : void 0
					});
				}
			} else t ?? i.d.M(e);
		}
	}, e.preload = function(e, t) {
		if (typeof e == "string" && typeof t == "object" && t && typeof t.as == "string") {
			var n = t.as, r = d(n, t.crossOrigin);
			i.d.L(e, n, {
				crossOrigin: r,
				integrity: typeof t.integrity == "string" ? t.integrity : void 0,
				nonce: typeof t.nonce == "string" ? t.nonce : void 0,
				type: typeof t.type == "string" ? t.type : void 0,
				fetchPriority: typeof t.fetchPriority == "string" ? t.fetchPriority : void 0,
				referrerPolicy: typeof t.referrerPolicy == "string" ? t.referrerPolicy : void 0,
				imageSrcSet: typeof t.imageSrcSet == "string" ? t.imageSrcSet : void 0,
				imageSizes: typeof t.imageSizes == "string" ? t.imageSizes : void 0,
				media: typeof t.media == "string" ? t.media : void 0
			});
		}
	}, e.preloadModule = function(e, t) {
		if (typeof e == "string") {
			if (t) {
				var n = d(t.as, t.crossOrigin);
				i.d.m(e, {
					as: typeof t.as == "string" && t.as !== "script" ? t.as : void 0,
					crossOrigin: n,
					integrity: typeof t.integrity == "string" ? t.integrity : void 0,
					nonce: typeof t.nonce == "string" ? t.nonce : void 0,
					fetchPriority: typeof t.fetchPriority == "string" ? t.fetchPriority : void 0
				});
			} else i.d.m(e);
		}
	}, e.requestFormReset = function(e) {
		i.d.r(e);
	}, e.unstable_batchedUpdates = function(e, t) {
		return e(t);
	}, e.useFormState = function(e, t, n) {
		return l.H.useFormState(e, t, n);
	}, e.useFormStatus = function() {
		return l.H.useHostTransitionStatus();
	}, e.version = "19.3.0";
})), m = /* @__PURE__ */ o(((e, t) => {
	function n() {
		if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE == "function") try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
		} catch (e) {
			console.error(e);
		}
	}
	n(), t.exports = p();
})), h = /* @__PURE__ */ o(((e) => {
	var t = f(), n = u(), r = m();
	function i(e) {
		var t = "https://react.dev/errors/" + e;
		if (1 < arguments.length) {
			t += "?args[]=" + encodeURIComponent(arguments[1]);
			for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		}
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	function a(e) {
		return !(!e || e.nodeType !== 1 && e.nodeType !== 9 && e.nodeType !== 11);
	}
	function o(e) {
		for (var t = e, n = t; n && !n.alternate;) t = n, t.flags & 4098 && (e = t.return), n = t.return;
		for (; t.return;) t = t.return;
		return t.tag === 3 ? e : null;
	}
	function s(e) {
		if (e.tag === 13) {
			var t = e.memoizedState;
			if (t === null && (e = e.alternate, e !== null && (t = e.memoizedState)), t !== null) return t.dehydrated;
		}
		return null;
	}
	function c(e) {
		if (e.tag === 31) {
			var t = e.memoizedState;
			if (t === null && (e = e.alternate, e !== null && (t = e.memoizedState)), t !== null) return t.dehydrated;
		}
		return null;
	}
	function l(e) {
		if (o(e) !== e) throw Error(i(188));
	}
	function d(e) {
		var t = e.alternate;
		if (!t) {
			if (t = o(e), t === null) throw Error(i(188));
			return t === e ? e : null;
		}
		for (var n = e, r = t;;) {
			var a = n.return;
			if (a === null) break;
			var s = a.alternate;
			if (s === null) {
				if (r = a.return, r !== null) {
					n = r;
					continue;
				}
				break;
			}
			if (a.child === s.child) {
				for (s = a.child; s;) {
					if (s === n) return l(a), e;
					if (s === r) return l(a), t;
					s = s.sibling;
				}
				throw Error(i(188));
			}
			if (n.return !== r.return) n = a, r = s;
			else {
				for (var c = !1, u = a.child; u;) {
					if (u === n) {
						c = !0, n = a, r = s;
						break;
					}
					if (u === r) {
						c = !0, r = a, n = s;
						break;
					}
					u = u.sibling;
				}
				if (!c) {
					for (u = s.child; u;) {
						if (u === n) {
							c = !0, n = s, r = a;
							break;
						}
						if (u === r) {
							c = !0, r = s, n = a;
							break;
						}
						u = u.sibling;
					}
					if (!c) throw Error(i(189));
				}
			}
			if (n.alternate !== r) throw Error(i(190));
		}
		if (n.tag !== 3) throw Error(i(188));
		return n.stateNode.current === n ? e : t;
	}
	function p(e) {
		var t = e.tag;
		if (t === 5 || t === 26 || t === 27 || t === 6) return e;
		for (e = e.child; e !== null;) {
			if (t = p(e), t !== null) return t;
			e = e.sibling;
		}
		return null;
	}
	function h(e, t, n, r, i, a) {
		for (; e !== null;) {
			if ((e.tag === 5 || e.tag === 27 || e.tag === 6) && n(e, r, i, a) || (e.tag !== 22 || e.memoizedState === null) && (t || e.tag !== 5 && e.tag !== 27) && h(e.child, t, n, r, i, a)) return !0;
			e = e.sibling;
		}
		return !1;
	}
	function g(e) {
		for (e = e.return; e !== null;) {
			if (e.tag === 3 || e.tag === 5 || e.tag === 27) return e;
			e = e.return;
		}
		return null;
	}
	function _(e) {
		var t = !1;
		for (e = e.return; e !== null && (e.tag === 4 && (t = !0), e.tag !== 3 && e.tag !== 5 && e.tag !== 27);) e = e.return;
		return t;
	}
	function v(e) {
		var t = [null, null], n = g(e);
		return n === null || y(t, e, n.child, { foundSelf: !1 }), t;
	}
	function y(e, t, n, r) {
		for (; n !== null;) {
			if (n === t) r.foundSelf = !0;
			else if (n.tag === 5 || n.tag === 27 || n.tag === 6) {
				if (r.foundSelf) return e[1] = n, !0;
				e[0] = n;
			} else if ((n.tag !== 22 || n.memoizedState === null) && y(e, t, n.child, r)) return !0;
			n = n.sibling;
		}
		return !1;
	}
	function b(e) {
		switch (e.tag) {
			case 5:
			case 27:
			case 6: return e.stateNode;
			case 3: return e.stateNode.containerInfo;
			default: throw Error(i(559));
		}
	}
	var x = null, S = null;
	function C(e, t, n) {
		return e === n || e === t && (x = e, !0);
	}
	function w(e, t, n) {
		return e === n ? (S = e, !1) : e === t && (S !== null && (x = e), !0);
	}
	function T(e) {
		if (e === null) return null;
		do
			e = e === null ? null : e.return;
		while (e && e.tag !== 5 && e.tag !== 27 && e.tag !== 3);
		return e || null;
	}
	function ee(e, t, n) {
		for (var r = 0, i = e; i; i = n(i)) r++;
		i = 0;
		for (var a = t; a; a = n(a)) i++;
		for (; 0 < r - i;) e = n(e), r--;
		for (; 0 < i - r;) t = n(t), i--;
		for (; r--;) {
			if (e === t || t !== null && e === t.alternate) return e;
			e = n(e), t = n(t);
		}
		return null;
	}
	var E = Object.assign, te = Symbol.for("react.element"), D = Symbol.for("react.transitional.element"), O = Symbol.for("react.portal"), ne = Symbol.for("react.fragment"), re = Symbol.for("react.strict_mode"), ie = Symbol.for("react.profiler"), ae = Symbol.for("react.consumer"), oe = Symbol.for("react.context"), se = Symbol.for("react.forward_ref"), ce = Symbol.for("react.suspense"), le = Symbol.for("react.suspense_list"), ue = Symbol.for("react.memo"), de = Symbol.for("react.lazy"), fe = Symbol.for("react.activity"), pe = Symbol.for("react.legacy_hidden"), me = Symbol.for("react.memo_cache_sentinel"), he = Symbol.for("react.view_transition"), ge = Symbol.for("react.recoverable"), _e = Symbol.iterator;
	function ve(e) {
		return typeof e != "object" || !e ? null : (e = _e && e[_e] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var ye = Symbol.for("react.client.reference");
	function be(e) {
		if (e == null) return null;
		if (typeof e == "function") return e.$$typeof === ye ? null : e.displayName || e.name || null;
		if (typeof e == "string") return e;
		switch (e) {
			case ne: return "Fragment";
			case ie: return "Profiler";
			case re: return "StrictMode";
			case ce: return "Suspense";
			case le: return "SuspenseList";
			case fe: return "Activity";
			case he: return "ViewTransition";
		}
		if (typeof e == "object") switch (e.$$typeof) {
			case O: return "Portal";
			case oe: return e.displayName || "Context";
			case ae: return (e._context.displayName || "Context") + ".Consumer";
			case se:
				var t = e.render;
				return e = e.displayName, e ||= (e = t.displayName || t.name || "", e === "" ? "ForwardRef" : "ForwardRef(" + e + ")"), e;
			case ue: return t = e.displayName || null, t === null ? be(e.type) || "Memo" : t;
			case de:
				t = e._payload, e = e._init;
				try {
					return be(e(t));
				} catch {}
		}
		return null;
	}
	var xe = Array.isArray, k = n.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, Se = r.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, Ce = {
		pending: !1,
		data: null,
		method: null,
		action: null
	}, we = [], Te = -1;
	function Ee(e) {
		return { current: e };
	}
	function De(e) {
		0 > Te || (e.current = we[Te], we[Te] = null, Te--);
	}
	function Oe(e, t) {
		Te++, we[Te] = e.current, e.current = t;
	}
	var ke = Ee(null), Ae = Ee(null), je = Ee(null), Me = Ee(null);
	function Ne(e, t) {
		switch (Oe(je, t), Oe(Ae, e), Oe(ke, null), t.nodeType) {
			case 9:
			case 11:
				e = (e = t.documentElement) && (e = e.namespaceURI) ? Tp(e) : 0;
				break;
			default: if (e = t.tagName, t = t.namespaceURI) t = Tp(t), e = Ep(t, e);
			else switch (e) {
				case "svg":
					e = 1;
					break;
				case "math":
					e = 2;
					break;
				default: e = 0;
			}
		}
		De(ke), Oe(ke, e);
	}
	function Pe() {
		De(ke), De(Ae), De(je);
	}
	function Fe(e) {
		var t = e.memoizedState;
		t !== null && (bh._currentValue = t.memoizedState, Oe(Me, e)), t = ke.current;
		var n = Ep(t, e.type);
		t !== n && (Oe(Ae, e), Oe(ke, n));
	}
	function Ie(e) {
		Ae.current === e && (De(ke), De(Ae)), Me.current === e && (De(Me), bh._currentValue = Ce);
	}
	var Le, Re;
	function ze(e) {
		if (Le === void 0) try {
			throw Error();
		} catch (e) {
			var t = e.stack.trim().match(/\n( *(at )?)/);
			Le = t && t[1] || "", Re = -1 < e.stack.indexOf("\n    at") ? " (<anonymous>)" : -1 < e.stack.indexOf("@") ? "@unknown:0:0" : "";
		}
		return "\n" + Le + e + Re;
	}
	var Be = !1;
	function Ve(e, t) {
		if (!e || Be) return "";
		Be = !0;
		var n = Error.prepareStackTrace;
		Error.prepareStackTrace = void 0;
		try {
			var r = { DetermineComponentFrameRoot: function() {
				try {
					if (t) {
						var n = function() {
							throw Error();
						};
						if (Object.defineProperty(n.prototype, "props", { set: function() {
							throw Error();
						} }), typeof Reflect == "object" && Reflect.construct) {
							try {
								Reflect.construct(n, []);
							} catch (e) {
								var r = e;
							}
							Reflect.construct(e, [], n);
						} else {
							try {
								n.call();
							} catch (e) {
								r = e;
							}
							n = !1;
							try {
								var i = Object.getOwnPropertyDescriptor(e.prototype, "props");
								Object.defineProperty(e.prototype, "props", {
									configurable: !0,
									set: function() {
										throw Error();
									}
								}), n = !0, new e();
							} finally {
								n && (i === void 0 ? delete e.prototype.props : Object.defineProperty(e.prototype, "props", i));
							}
						}
					} else {
						try {
							throw Error();
						} catch (e) {
							r = e;
						}
						(n = e()) && typeof n.catch == "function" && n.catch(function() {});
					}
				} catch (e) {
					if (e && r && typeof e.stack == "string") return [e.stack, r.stack];
				}
				return [null, null];
			} };
			r.DetermineComponentFrameRoot.displayName = "DetermineComponentFrameRoot";
			var i = Object.getOwnPropertyDescriptor(r.DetermineComponentFrameRoot, "name");
			i && i.configurable && Object.defineProperty(r.DetermineComponentFrameRoot, "name", { value: "DetermineComponentFrameRoot" });
			var a = r.DetermineComponentFrameRoot(), o = a[0], s = a[1];
			if (o && s) {
				var c = o.split("\n"), l = s.split("\n");
				for (i = r = 0; r < c.length && !c[r].includes("DetermineComponentFrameRoot");) r++;
				for (; i < l.length && !l[i].includes("DetermineComponentFrameRoot");) i++;
				if (r === c.length || i === l.length) for (r = c.length - 1, i = l.length - 1; 1 <= r && 0 <= i && c[r] !== l[i];) i--;
				for (; 1 <= r && 0 <= i; r--, i--) if (c[r] !== l[i]) {
					if (r !== 1 || i !== 1) do
						if (r--, i--, 0 > i || c[r] !== l[i]) {
							var u = "\n" + c[r].replace(" at new ", " at ");
							return e.displayName && u.includes("<anonymous>") && (u = u.replace("<anonymous>", e.displayName)), u;
						}
					while (1 <= r && 0 <= i);
					break;
				}
			}
		} finally {
			Be = !1, Error.prepareStackTrace = n;
		}
		return (n = e ? e.displayName || e.name : "") ? ze(n) : "";
	}
	function He(e, t) {
		switch (e.tag) {
			case 26:
			case 27:
			case 5: return ze(e.type);
			case 16: return ze("Lazy");
			case 13: return e.child !== t && t !== null ? ze("Suspense Fallback") : ze("Suspense");
			case 19: return ze("SuspenseList");
			case 0:
			case 15: return Ve(e.type, !1);
			case 11: return Ve(e.type.render, !1);
			case 1: return Ve(e.type, !0);
			case 31: return ze("Activity");
			case 30: return ze("ViewTransition");
			default: return "";
		}
	}
	function Ue(e) {
		try {
			var t = "", n = null;
			do
				t += He(e, n), n = e, e = e.return;
			while (e);
			return t;
		} catch (e) {
			return "\nError generating stack: " + e.message + "\n" + e.stack;
		}
	}
	var We = Object.prototype.hasOwnProperty, Ge = t.unstable_scheduleCallback, Ke = t.unstable_cancelCallback, qe = t.unstable_shouldYield, Je = t.unstable_requestPaint, Ye = t.unstable_now, Xe = t.unstable_getCurrentPriorityLevel, Ze = t.unstable_ImmediatePriority, Qe = t.unstable_UserBlockingPriority, $e = t.unstable_NormalPriority, et = t.unstable_LowPriority, tt = t.unstable_IdlePriority, nt = t.log, rt = t.unstable_setDisableYieldValue, it = null, at = null;
	function ot(e) {
		if (typeof nt == "function" && rt(e), at && typeof at.setStrictMode == "function") try {
			at.setStrictMode(it, e);
		} catch {}
	}
	var st = Math.clz32 ? Math.clz32 : ut, ct = Math.log, lt = Math.LN2;
	function ut(e) {
		return e >>>= 0, e === 0 ? 32 : 31 - (ct(e) / lt | 0) | 0;
	}
	var dt = 256, ft = 262144, pt = 4194304;
	function mt(e) {
		var t = e & 42;
		if (t !== 0) return t;
		switch (e & -e) {
			case 1: return 1;
			case 2: return 2;
			case 4: return 4;
			case 8: return 8;
			case 16: return 16;
			case 32: return 32;
			case 64: return 64;
			case 128: return 128;
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072: return e & -e;
			case 262144:
			case 524288:
			case 1048576:
			case 2097152: return e & 3932160;
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432: return e & 62914560;
			case 67108864: return 67108864;
			case 134217728: return 134217728;
			case 268435456: return 268435456;
			case 536870912: return 536870912;
			case 1073741824: return 0;
			default: return e;
		}
	}
	function ht(e, t, n) {
		var r = e.pendingLanes;
		if (r === 0) return 0;
		var i = 0, a = e.suspendedLanes, o = e.pingedLanes;
		e = e.warmLanes;
		var s = r & 134217727;
		return s === 0 ? (s = r & ~a, s === 0 ? o === 0 ? n || (n = r & ~e, n !== 0 && (i = mt(n))) : i = mt(o) : i = mt(s)) : (r = s & ~a, r === 0 ? (o &= s, o === 0 ? n || (n = s & ~e, n !== 0 && (i = mt(n))) : i = mt(o)) : i = mt(r)), i === 0 ? 0 : t !== 0 && t !== i && (t & a) === 0 && (a = i & -i, n = t & -t, a >= n || a === 32 && n & 4194048) ? t : i;
	}
	function gt(e, t) {
		return (e.pendingLanes & ~(e.suspendedLanes & ~e.pingedLanes) & t) === 0;
	}
	function _t(e, t) {
		t & 8 && (t |= t & 32);
		var n = e.entangledLanes;
		if (n !== 0) for (e = e.entanglements, n &= t; 0 < n;) {
			var r = 31 - st(n), i = 1 << r;
			t |= e[r], n &= ~i;
		}
		return t;
	}
	function vt(e, t) {
		switch (e) {
			case 1:
			case 2:
			case 4:
			case 8:
			case 64: return t + 250;
			case 16:
			case 32:
			case 128:
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072:
			case 262144:
			case 524288:
			case 1048576:
			case 2097152: return t + 5e3;
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432: return -1;
			case 67108864:
			case 134217728:
			case 268435456:
			case 536870912:
			case 1073741824: return -1;
			default: return -1;
		}
	}
	function yt() {
		var e = pt;
		return pt <<= 1, !(pt & 62914560) && (pt = 4194304), e;
	}
	function bt(e) {
		for (var t = [], n = 0; 31 > n; n++) t.push(e);
		return t;
	}
	function xt(e, t) {
		e.pendingLanes |= t, t !== 268435456 && (e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0);
	}
	function St(e, t, n, r, i, a) {
		var o = e.pendingLanes;
		e.pendingLanes = n, e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0, e.expiredLanes &= n, e.entangledLanes &= n, e.errorRecoveryDisabledLanes &= n, e.shellSuspendCounter = 0;
		var s = e.entanglements, c = e.expirationTimes, l = e.hiddenUpdates;
		for (n = o & ~n; 0 < n;) {
			var u = 31 - st(n), d = 1 << u;
			s[u] = 0, c[u] = -1;
			var f = l[u];
			if (f !== null) for (l[u] = null, u = 0; u < f.length; u++) {
				var p = f[u];
				p !== null && (p.lane &= -536870913);
			}
			n &= ~d;
		}
		r !== 0 && Ct(e, r, 0), a !== 0 && i === 0 && e.tag !== 0 && (e.suspendedLanes |= a & ~(o & ~t));
	}
	function Ct(e, t, n) {
		e.pendingLanes |= t, e.suspendedLanes &= ~t;
		var r = 31 - st(t);
		e.entangledLanes |= t, e.entanglements[r] = e.entanglements[r] | 1073741824 | n & 261930;
	}
	function wt(e, t) {
		var n = e.entangledLanes |= t;
		for (e = e.entanglements; n;) {
			var r = 31 - st(n), i = 1 << r;
			i & t | e[r] & t && (e[r] |= t), n &= ~i;
		}
	}
	function Tt(e, t) {
		var n = t & -t;
		return n = n & 42 ? 1 : Et(n), (n & (e.suspendedLanes | t)) === 0 ? n : 0;
	}
	function Et(e) {
		switch (e) {
			case 2:
				e = 1;
				break;
			case 8:
				e = 4;
				break;
			case 32:
				e = 16;
				break;
			case 256:
			case 512:
			case 1024:
			case 2048:
			case 4096:
			case 8192:
			case 16384:
			case 32768:
			case 65536:
			case 131072:
			case 262144:
			case 524288:
			case 1048576:
			case 2097152:
			case 4194304:
			case 8388608:
			case 16777216:
			case 33554432:
				e = 128;
				break;
			case 268435456:
				e = 134217728;
				break;
			default: e = 0;
		}
		return e;
	}
	function Dt(e) {
		return e &= -e, 2 < e ? 8 < e ? e & 134217727 ? 32 : 268435456 : 8 : 2;
	}
	function Ot() {
		var e = Se.p;
		return e === 0 ? (e = window.event, e === void 0 ? 32 : Ih(e.type)) : e;
	}
	function kt(e, t) {
		var n = Se.p;
		try {
			return Se.p = e, t();
		} finally {
			Se.p = n;
		}
	}
	var At = Math.random().toString(36).slice(2), jt = "__reactFiber$" + At, Mt = "__reactProps$" + At, Nt = "__reactContainer$" + At, Pt = "__reactEvents$" + At, Ft = "__reactListeners$" + At, It = "__reactHandles$" + At, Lt = "__reactResources$" + At, Rt = "__reactMarker$" + At, zt = "__reactLoad$" + At;
	function Bt(e) {
		delete e[jt], delete e[Mt], delete e[Ft], delete e[It];
	}
	function Vt(e) {
		var t;
		if (t = e[jt]) return t;
		for (var n = e.parentNode; n;) {
			if (t = n[Nt] || n[jt]) {
				if (n = t.alternate, t.child !== null || n !== null && n.child !== null) for (e = Dm(e); e !== null;) {
					if (n = e[jt]) return n;
					e = Dm(e);
				}
				return t;
			}
			e = n, n = e.parentNode;
		}
		return null;
	}
	function Ht(e) {
		if (e = e[jt] || e[Nt]) {
			var t = e.tag;
			if (t === 5 || t === 6 || t === 13 || t === 31 || t === 26 || t === 27 || t === 3) return e;
		}
		return null;
	}
	function Ut(e) {
		var t = e.tag;
		if (t === 5 || t === 26 || t === 27 || t === 6) return e.stateNode;
		throw Error(i(33));
	}
	function Wt(e) {
		var t = e[Lt];
		return t ||= e[Lt] = {
			hoistableStyles: /* @__PURE__ */ new Map(),
			hoistableScripts: /* @__PURE__ */ new Map()
		}, t;
	}
	function Gt(e) {
		e[Rt] = !0;
	}
	function Kt(e) {
		e[zt] = void 0;
	}
	var qt = /* @__PURE__ */ new Set(), Jt = {};
	function Yt(e, t) {
		Xt(e, t), Xt(e + "Capture", t);
	}
	function Xt(e, t) {
		for (Jt[e] = t, e = 0; e < t.length; e++) qt.add(t[e]);
	}
	var Zt = RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"), Qt = {}, $t = {};
	function en(e) {
		return We.call($t, e) ? !0 : We.call(Qt, e) ? !1 : Zt.test(e) ? $t[e] = !0 : (Qt[e] = !0, !1);
	}
	var tn = !1;
	function nn() {
		var e = tn;
		return tn = !1, e;
	}
	function rn(e, t, n) {
		if (en(t)) {
			if (n === null) e.removeAttribute(t);
			else {
				switch (typeof n) {
					case "undefined":
					case "function":
					case "symbol":
						e.removeAttribute(t);
						return;
					case "boolean":
						var r = t.toLowerCase().slice(0, 5);
						if (r !== "data-" && r !== "aria-") {
							e.removeAttribute(t);
							return;
						}
				}
				e.setAttribute(t, n);
			}
		}
	}
	function an(e, t, n) {
		if (n === null) e.removeAttribute(t);
		else {
			switch (typeof n) {
				case "undefined":
				case "function":
				case "symbol":
				case "boolean":
					e.removeAttribute(t);
					return;
			}
			e.setAttribute(t, n);
		}
	}
	function on(e, t, n, r) {
		if (r === null) e.removeAttribute(n);
		else {
			switch (typeof r) {
				case "undefined":
				case "function":
				case "symbol":
				case "boolean":
					e.removeAttribute(n);
					return;
			}
			e.setAttributeNS(t, n, r);
		}
	}
	function sn(e) {
		switch (typeof e) {
			case "bigint":
			case "boolean":
			case "number":
			case "string":
			case "undefined": return e;
			case "object": return e;
			default: return "";
		}
	}
	function cn(e) {
		var t = e.type;
		return (e = e.nodeName) && e.toLowerCase() === "input" && (t === "checkbox" || t === "radio");
	}
	function A(e, t, n) {
		var r = Object.getOwnPropertyDescriptor(e.constructor.prototype, t);
		if (!e.hasOwnProperty(t) && r !== void 0 && typeof r.get == "function" && typeof r.set == "function") {
			var i = r.get, a = r.set;
			return Object.defineProperty(e, t, {
				configurable: !0,
				get: function() {
					return i.call(this);
				},
				set: function(e) {
					n = "" + e, a.call(this, e);
				}
			}), Object.defineProperty(e, t, { enumerable: r.enumerable }), {
				getValue: function() {
					return n;
				},
				setValue: function(e) {
					n = "" + e;
				},
				stopTracking: function() {
					e._valueTracker = null, delete e[t];
				}
			};
		}
	}
	function ln(e) {
		if (!e._valueTracker) {
			var t = cn(e) ? "checked" : "value";
			e._valueTracker = A(e, t, "" + e[t]);
		}
	}
	function un(e) {
		if (!e) return !1;
		var t = e._valueTracker;
		if (!t) return !0;
		var n = t.getValue(), r = "";
		return e && (r = cn(e) ? e.checked ? "true" : "false" : e.value), e = r, e !== n && (t.setValue(e), !0);
	}
	var dn = /[\n"\\]/g;
	function fn(e) {
		return e.replace(dn, function(e) {
			return "\\" + e.charCodeAt(0).toString(16) + " ";
		});
	}
	function pn(e, t, n, r, i, a, o, s) {
		e.name = "", o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" ? e.type = o : e.removeAttribute("type"), t == null ? o !== "submit" && o !== "reset" || e.removeAttribute("value") : o === "number" ? (t === 0 && e.value === "" || e.value != t) && (e.value = "" + sn(t)) : e.value !== "" + sn(t) && (e.value = "" + sn(t)), t == null ? n == null ? r != null && e.removeAttribute("value") : hn(e, sn(n)) : o === "number" && e.value == t ? hn(e, sn(e.value)) : hn(e, sn(t)), i == null && a != null && (e.defaultChecked = !!a), i != null && (e.checked = i && typeof i != "function" && typeof i != "symbol"), s != null && typeof s != "function" && typeof s != "symbol" && typeof s != "boolean" ? e.name = "" + sn(s) : e.removeAttribute("name");
	}
	function mn(e, t, n, r, i, a, o, s) {
		if (a != null && typeof a != "function" && typeof a != "symbol" && typeof a != "boolean" && (e.type = a), t != null || n != null) {
			if (!(a !== "submit" && a !== "reset" || t != null)) {
				ln(e);
				return;
			}
			n = n == null ? "" : "" + sn(n), t = t == null ? n : "" + sn(t), s || t === e.value || (e.value = t), e.defaultValue = t;
		}
		r ??= i, r = typeof r != "function" && typeof r != "symbol" && !!r, e.checked = s ? e.checked : !!r, e.defaultChecked = !!r, o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" && (e.name = o), ln(e);
	}
	function hn(e, t) {
		e.defaultValue !== "" + t && (e.defaultValue = "" + t);
	}
	function gn(e, t, n, r) {
		if (e = e.options, t) {
			t = {};
			for (var i = 0; i < n.length; i++) t["$" + n[i]] = !0;
			for (n = 0; n < e.length; n++) i = t.hasOwnProperty("$" + e[n].value), e[n].selected !== i && (e[n].selected = i), i && r && (e[n].defaultSelected = !0);
		} else {
			for (n = "" + sn(n), t = null, i = 0; i < e.length; i++) {
				if (e[i].value === n) {
					e[i].selected = !0, r && (e[i].defaultSelected = !0);
					return;
				}
				t !== null || e[i].disabled || (t = e[i]);
			}
			t !== null && (t.selected = !0);
		}
	}
	function _n(e, t, n) {
		if (t != null && (t = "" + sn(t), t !== e.value && (e.value = t), n == null)) {
			e.defaultValue !== t && (e.defaultValue = t);
			return;
		}
		e.defaultValue = n == null ? "" : "" + sn(n);
	}
	function vn(e, t, n, r) {
		if (t == null) {
			if (r != null) {
				if (n != null) throw Error(i(92));
				if (xe(r)) {
					if (1 < r.length) throw Error(i(93));
					r = r[0];
				}
				n = r;
			}
			n ??= "", t = n;
		}
		n = sn(t), e.defaultValue = n, r = e.textContent, r === n && r !== "" && r !== null && (e.value = r), ln(e);
	}
	function yn(e, t) {
		if (t) {
			var n = e.firstChild;
			if (n && n === e.lastChild && n.nodeType === 3) {
				n.nodeValue = t;
				return;
			}
		}
		e.textContent = t;
	}
	var bn = new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));
	function xn(e, t, n) {
		var r = t.indexOf("--") === 0;
		n == null || typeof n == "boolean" || n === "" ? r ? e.setProperty(t, "") : t === "float" ? e.cssFloat = "" : e[t] = "" : r ? e.setProperty(t, n) : typeof n != "number" || n === 0 || bn.has(t) ? t === "float" ? e.cssFloat = n : e[t] = ("" + n).trim() : e[t] = n + "px";
	}
	function Sn(e, t, n) {
		if (t != null && typeof t != "object") throw Error(i(62));
		if (e = e.style, n != null) {
			for (var r in n) !n.hasOwnProperty(r) || t != null && t.hasOwnProperty(r) || (r.indexOf("--") === 0 ? e.setProperty(r, "") : r === "float" ? e.cssFloat = "" : e[r] = "", tn = !0);
			for (var a in t) r = t[a], t.hasOwnProperty(a) && n[a] !== r && (xn(e, a, r), tn = !0);
		} else for (var o in t) t.hasOwnProperty(o) && xn(e, o, t[o]);
	}
	function Cn(e) {
		if (e.indexOf("-") === -1) return !1;
		switch (e) {
			case "annotation-xml":
			case "color-profile":
			case "font-face":
			case "font-face-src":
			case "font-face-uri":
			case "font-face-format":
			case "font-face-name":
			case "missing-glyph": return !1;
			default: return !0;
		}
	}
	var wn = /* @__PURE__ */ new Map([
		["acceptCharset", "accept-charset"],
		["htmlFor", "for"],
		["httpEquiv", "http-equiv"],
		["crossOrigin", "crossorigin"],
		["accentHeight", "accent-height"],
		["alignmentBaseline", "alignment-baseline"],
		["arabicForm", "arabic-form"],
		["baselineShift", "baseline-shift"],
		["capHeight", "cap-height"],
		["clipPath", "clip-path"],
		["clipRule", "clip-rule"],
		["colorInterpolation", "color-interpolation"],
		["colorInterpolationFilters", "color-interpolation-filters"],
		["colorProfile", "color-profile"],
		["colorRendering", "color-rendering"],
		["dominantBaseline", "dominant-baseline"],
		["enableBackground", "enable-background"],
		["fillOpacity", "fill-opacity"],
		["fillRule", "fill-rule"],
		["floodColor", "flood-color"],
		["floodOpacity", "flood-opacity"],
		["fontFamily", "font-family"],
		["fontSize", "font-size"],
		["fontSizeAdjust", "font-size-adjust"],
		["fontStretch", "font-stretch"],
		["fontStyle", "font-style"],
		["fontVariant", "font-variant"],
		["fontWeight", "font-weight"],
		["glyphName", "glyph-name"],
		["glyphOrientationHorizontal", "glyph-orientation-horizontal"],
		["glyphOrientationVertical", "glyph-orientation-vertical"],
		["horizAdvX", "horiz-adv-x"],
		["horizOriginX", "horiz-origin-x"],
		["imageRendering", "image-rendering"],
		["letterSpacing", "letter-spacing"],
		["lightingColor", "lighting-color"],
		["markerEnd", "marker-end"],
		["markerMid", "marker-mid"],
		["markerStart", "marker-start"],
		["maskType", "mask-type"],
		["overlinePosition", "overline-position"],
		["overlineThickness", "overline-thickness"],
		["paintOrder", "paint-order"],
		["panose-1", "panose-1"],
		["pointerEvents", "pointer-events"],
		["renderingIntent", "rendering-intent"],
		["shapeRendering", "shape-rendering"],
		["stopColor", "stop-color"],
		["stopOpacity", "stop-opacity"],
		["strikethroughPosition", "strikethrough-position"],
		["strikethroughThickness", "strikethrough-thickness"],
		["strokeDasharray", "stroke-dasharray"],
		["strokeDashoffset", "stroke-dashoffset"],
		["strokeLinecap", "stroke-linecap"],
		["strokeLinejoin", "stroke-linejoin"],
		["strokeMiterlimit", "stroke-miterlimit"],
		["strokeOpacity", "stroke-opacity"],
		["strokeWidth", "stroke-width"],
		["textAnchor", "text-anchor"],
		["textDecoration", "text-decoration"],
		["textRendering", "text-rendering"],
		["transformOrigin", "transform-origin"],
		["underlinePosition", "underline-position"],
		["underlineThickness", "underline-thickness"],
		["unicodeBidi", "unicode-bidi"],
		["unicodeRange", "unicode-range"],
		["unitsPerEm", "units-per-em"],
		["vAlphabetic", "v-alphabetic"],
		["vHanging", "v-hanging"],
		["vIdeographic", "v-ideographic"],
		["vMathematical", "v-mathematical"],
		["vectorEffect", "vector-effect"],
		["vertAdvY", "vert-adv-y"],
		["vertOriginX", "vert-origin-x"],
		["vertOriginY", "vert-origin-y"],
		["wordSpacing", "word-spacing"],
		["writingMode", "writing-mode"],
		["xmlnsXlink", "xmlns:xlink"],
		["xHeight", "x-height"]
	]), Tn = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
	function En(e) {
		return Tn.test("" + e) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : e;
	}
	function Dn() {}
	var On = null;
	function kn(e) {
		return e = e.target || e.srcElement || window, e.correspondingUseElement && (e = e.correspondingUseElement), e.nodeType === 3 ? e.parentNode : e;
	}
	var An = null, jn = null;
	function Mn(e) {
		var t = Ht(e);
		if (t && (e = t.stateNode)) {
			var n = e[Mt] || null;
			a: switch (e = t.stateNode, t.type) {
				case "input":
					if (pn(e, n.value, n.defaultValue, n.defaultValue, n.checked, n.defaultChecked, n.type, n.name), t = n.name, n.type === "radio" && t != null) {
						for (n = e; n.parentNode;) n = n.parentNode;
						for (n = n.querySelectorAll("input[name=\"" + fn("" + t) + "\"][type=\"radio\"]"), t = 0; t < n.length; t++) {
							var r = n[t];
							if (r !== e && r.form === e.form) {
								var a = r[Mt] || null;
								if (!a) throw Error(i(90));
								pn(r, a.value, a.defaultValue, a.defaultValue, a.checked, a.defaultChecked, a.type, a.name);
							}
						}
						for (t = 0; t < n.length; t++) r = n[t], r.form === e.form && un(r);
					}
					break a;
				case "textarea":
					_n(e, n.value, n.defaultValue);
					break a;
				case "select": t = n.value, t != null && gn(e, !!n.multiple, t, !1);
			}
		}
	}
	var Nn = !1;
	function Pn(e, t, n) {
		if (Nn) return e(t, n);
		Nn = !0;
		try {
			return e(t);
		} finally {
			if (Nn = !1, (An !== null || jn !== null) && (Qd(), An && (t = An, e = jn, jn = An = null, Mn(t), e))) for (t = 0; t < e.length; t++) Mn(e[t]);
		}
	}
	function Fn(e, t) {
		var n = e.stateNode;
		if (n === null) return null;
		var r = n[Mt] || null;
		if (r === null) return null;
		n = r[t];
		a: switch (t) {
			case "onClick":
			case "onClickCapture":
			case "onDoubleClick":
			case "onDoubleClickCapture":
			case "onMouseDown":
			case "onMouseDownCapture":
			case "onMouseMove":
			case "onMouseMoveCapture":
			case "onMouseUp":
			case "onMouseUpCapture":
			case "onMouseEnter":
				(r = !r.disabled) || (e = e.type, r = e !== "button" && e !== "input" && e !== "select" && e !== "textarea"), e = !r;
				break a;
			default: e = !1;
		}
		if (e) return null;
		if (n && typeof n != "function") throw Error(i(231, t, typeof n));
		return n;
	}
	var In = typeof window < "u" && window.document !== void 0 && window.document.createElement !== void 0, j = !1;
	if (In) try {
		var Ln = {};
		Object.defineProperty(Ln, "passive", { get: function() {
			j = !0;
		} }), window.addEventListener("test", Ln, Ln), window.removeEventListener("test", Ln, Ln);
	} catch {
		j = !1;
	}
	var Rn = null, zn = null, Bn = null;
	function Vn() {
		if (Bn) return Bn;
		var e, t = zn, n = t.length, r, i = "value" in Rn ? Rn.value : Rn.textContent, a = i.length;
		for (e = 0; e < n && t[e] === i[e]; e++);
		var o = n - e;
		for (r = 1; r <= o && t[n - r] === i[a - r]; r++);
		return Bn = i.slice(e, 1 < r ? 1 - r : void 0);
	}
	function Hn(e) {
		var t = e.keyCode;
		return "charCode" in e ? (e = e.charCode, e === 0 && t === 13 && (e = 13)) : e = t, e === 10 && (e = 13), 32 <= e || e === 13 ? e : 0;
	}
	function Un() {
		return !0;
	}
	function Wn() {
		return !1;
	}
	function Gn(e) {
		function t(t, n, r, i, a) {
			for (var o in this._reactName = t, this._targetInst = r, this.type = n, this.nativeEvent = i, this.target = a, this.currentTarget = null, e) e.hasOwnProperty(o) && (t = e[o], this[o] = t ? t(i) : i[o]);
			return this.isDefaultPrevented = (i.defaultPrevented == null ? !1 === i.returnValue : i.defaultPrevented) ? Un : Wn, this.isPropagationStopped = Wn, this;
		}
		return E(t.prototype, {
			preventDefault: function() {
				this.defaultPrevented = !0;
				var e = this.nativeEvent;
				e && (e.preventDefault ? e.preventDefault() : typeof e.returnValue != "unknown" && (e.returnValue = !1), this.isDefaultPrevented = Un);
			},
			stopPropagation: function() {
				var e = this.nativeEvent;
				e && (e.stopPropagation ? e.stopPropagation() : typeof e.cancelBubble != "unknown" && (e.cancelBubble = !0), this.isPropagationStopped = Un);
			},
			persist: function() {},
			isPersistent: Un
		}), t;
	}
	var Kn = {
		eventPhase: 0,
		bubbles: 0,
		cancelable: 0,
		timeStamp: function(e) {
			return e.timeStamp || Date.now();
		},
		defaultPrevented: 0,
		isTrusted: 0
	}, M = Gn(Kn), qn = E({}, Kn, {
		view: 0,
		detail: 0
	}), Jn = Gn(qn), Yn, Xn, Zn, Qn = E({}, qn, {
		screenX: 0,
		screenY: 0,
		clientX: 0,
		clientY: 0,
		pageX: 0,
		pageY: 0,
		ctrlKey: 0,
		shiftKey: 0,
		altKey: 0,
		metaKey: 0,
		getModifierState: lr,
		button: 0,
		buttons: 0,
		relatedTarget: function(e) {
			return e.relatedTarget === void 0 ? e.fromElement === e.srcElement ? e.toElement : e.fromElement : e.relatedTarget;
		},
		movementX: function(e) {
			return "movementX" in e ? e.movementX : (e !== Zn && (Zn && e.type === "mousemove" ? (Yn = e.screenX - Zn.screenX, Xn = e.screenY - Zn.screenY) : Xn = Yn = 0, Zn = e), Yn);
		},
		movementY: function(e) {
			return "movementY" in e ? e.movementY : Xn;
		}
	}), $n = Gn(Qn), er = Gn(E({}, Qn, { dataTransfer: 0 })), tr = Gn(E({}, qn, { relatedTarget: 0 })), nr = Gn(E({}, Kn, {
		animationName: 0,
		elapsedTime: 0,
		pseudoElement: 0
	})), rr = Gn(E({}, Kn, { clipboardData: function(e) {
		return "clipboardData" in e ? e.clipboardData : window.clipboardData;
	} })), ir = Gn(E({}, Kn, { data: 0 })), ar = {
		Esc: "Escape",
		Spacebar: " ",
		Left: "ArrowLeft",
		Up: "ArrowUp",
		Right: "ArrowRight",
		Down: "ArrowDown",
		Del: "Delete",
		Win: "OS",
		Menu: "ContextMenu",
		Apps: "ContextMenu",
		Scroll: "ScrollLock",
		MozPrintableKey: "Unidentified"
	}, or = {
		8: "Backspace",
		9: "Tab",
		12: "Clear",
		13: "Enter",
		16: "Shift",
		17: "Control",
		18: "Alt",
		19: "Pause",
		20: "CapsLock",
		27: "Escape",
		32: " ",
		33: "PageUp",
		34: "PageDown",
		35: "End",
		36: "Home",
		37: "ArrowLeft",
		38: "ArrowUp",
		39: "ArrowRight",
		40: "ArrowDown",
		45: "Insert",
		46: "Delete",
		112: "F1",
		113: "F2",
		114: "F3",
		115: "F4",
		116: "F5",
		117: "F6",
		118: "F7",
		119: "F8",
		120: "F9",
		121: "F10",
		122: "F11",
		123: "F12",
		144: "NumLock",
		145: "ScrollLock",
		224: "Meta"
	}, sr = {
		Alt: "altKey",
		Control: "ctrlKey",
		Meta: "metaKey",
		Shift: "shiftKey"
	};
	function cr(e) {
		var t = this.nativeEvent;
		return t.getModifierState ? t.getModifierState(e) : (e = sr[e]) ? !!t[e] : !1;
	}
	function lr() {
		return cr;
	}
	var ur = Gn(E({}, qn, {
		key: function(e) {
			if (e.key) {
				var t = ar[e.key] || e.key;
				if (t !== "Unidentified") return t;
			}
			return e.type === "keypress" ? (e = Hn(e), e === 13 ? "Enter" : String.fromCharCode(e)) : e.type === "keydown" || e.type === "keyup" ? or[e.keyCode] || "Unidentified" : "";
		},
		code: 0,
		location: 0,
		ctrlKey: 0,
		shiftKey: 0,
		altKey: 0,
		metaKey: 0,
		repeat: 0,
		locale: 0,
		getModifierState: lr,
		charCode: function(e) {
			return e.type === "keypress" ? Hn(e) : 0;
		},
		keyCode: function(e) {
			return e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
		},
		which: function(e) {
			return e.type === "keypress" ? Hn(e) : e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
		}
	})), dr = Gn(E({}, Qn, {
		pointerId: 0,
		width: 0,
		height: 0,
		pressure: 0,
		tangentialPressure: 0,
		tiltX: 0,
		tiltY: 0,
		twist: 0,
		pointerType: 0,
		isPrimary: 0
	})), fr = Gn(E({}, Kn, { submitter: 0 })), pr = Gn(E({}, qn, {
		touches: 0,
		targetTouches: 0,
		changedTouches: 0,
		altKey: 0,
		metaKey: 0,
		ctrlKey: 0,
		shiftKey: 0,
		getModifierState: lr
	})), mr = Gn(E({}, Kn, {
		propertyName: 0,
		elapsedTime: 0,
		pseudoElement: 0
	})), hr = Gn(E({}, Qn, {
		deltaX: function(e) {
			return "deltaX" in e ? e.deltaX : "wheelDeltaX" in e ? -e.wheelDeltaX : 0;
		},
		deltaY: function(e) {
			return "deltaY" in e ? e.deltaY : "wheelDeltaY" in e ? -e.wheelDeltaY : "wheelDelta" in e ? -e.wheelDelta : 0;
		},
		deltaZ: 0,
		deltaMode: 0
	})), gr = Gn(E({}, Kn, {
		newState: 0,
		oldState: 0,
		source: 0
	})), _r = [
		9,
		13,
		27,
		32
	], vr = In && "CompositionEvent" in window, yr = null;
	In && "documentMode" in document && (yr = document.documentMode);
	var br = In && "TextEvent" in window && !yr, xr = In && (!vr || yr && 8 < yr && 11 >= yr), Sr = " ", Cr = !1;
	function wr(e, t) {
		switch (e) {
			case "keyup": return _r.indexOf(t.keyCode) !== -1;
			case "keydown": return t.keyCode !== 229;
			case "keypress":
			case "mousedown":
			case "focusout": return !0;
			default: return !1;
		}
	}
	function Tr(e) {
		return e = e.detail, typeof e == "object" && "data" in e ? e.data : null;
	}
	var Er = !1;
	function Dr(e, t) {
		switch (e) {
			case "compositionend": return Tr(t);
			case "keypress": return t.which === 32 ? (Cr = !0, Sr) : null;
			case "textInput": return e = t.data, e === Sr && Cr ? null : e;
			default: return null;
		}
	}
	function Or(e, t) {
		if (Er) return e === "compositionend" || !vr && wr(e, t) ? (e = Vn(), Bn = zn = Rn = null, Er = !1, e) : null;
		switch (e) {
			case "paste": return null;
			case "keypress":
				if (!(t.ctrlKey || t.altKey || t.metaKey) || t.ctrlKey && t.altKey) {
					if (t.char && 1 < t.char.length) return t.char;
					if (t.which) return String.fromCharCode(t.which);
				}
				return null;
			case "compositionend": return xr && t.locale !== "ko" ? null : t.data;
			default: return null;
		}
	}
	var kr = {
		color: !0,
		date: !0,
		datetime: !0,
		"datetime-local": !0,
		email: !0,
		month: !0,
		number: !0,
		password: !0,
		range: !0,
		search: !0,
		tel: !0,
		text: !0,
		time: !0,
		url: !0,
		week: !0
	};
	function Ar(e) {
		var t = e && e.nodeName && e.nodeName.toLowerCase();
		return t === "input" ? !!kr[e.type] : t === "textarea";
	}
	function jr(e, t, n, r) {
		An ? jn ? jn.push(r) : jn = [r] : An = r, t = cp(t, "onChange"), 0 < t.length && (n = new M("onChange", "change", null, n, r), e.push({
			event: n,
			listeners: t
		}));
	}
	var Mr = null, Nr = null;
	function Pr(e) {
		tp(e, 0);
	}
	function Fr(e) {
		if (un(Ut(e))) return e;
	}
	function Ir(e, t) {
		if (e === "change") return t;
	}
	var Lr = !1;
	if (In) {
		var Rr;
		if (In) {
			var zr = "oninput" in document;
			if (!zr) {
				var Br = document.createElement("div");
				Br.setAttribute("oninput", "return;"), zr = typeof Br.oninput == "function";
			}
			Rr = zr;
		} else Rr = !1;
		Lr = Rr && (!document.documentMode || 9 < document.documentMode);
	}
	function Vr() {
		Mr && (Mr.detachEvent("onpropertychange", Hr), Nr = Mr = null);
	}
	function Hr(e) {
		if (e.propertyName === "value" && Fr(Nr)) {
			var t = [];
			jr(t, Nr, e, kn(e)), Pn(Pr, t);
		}
	}
	function Ur(e, t, n) {
		e === "focusin" ? (Vr(), Mr = t, Nr = n, Mr.attachEvent("onpropertychange", Hr)) : e === "focusout" && Vr();
	}
	function Wr(e) {
		if (e === "selectionchange" || e === "keyup" || e === "keydown") return Fr(Nr);
	}
	function Gr(e, t) {
		if (e === "click") return Fr(t);
	}
	function Kr(e, t) {
		if (e === "input" || e === "change") return Fr(t);
	}
	function qr(e, t) {
		return e === t && (e !== 0 || 1 / e == 1 / t) || e !== e && t !== t;
	}
	var Jr = typeof Object.is == "function" ? Object.is : qr;
	function Yr(e, t) {
		if (Jr(e, t)) return !0;
		if (typeof e != "object" || !e || typeof t != "object" || !t) return !1;
		var n = Object.keys(e), r = Object.keys(t);
		if (n.length !== r.length) return !1;
		for (r = 0; r < n.length; r++) {
			var i = n[r];
			if (!We.call(t, i) || !Jr(e[i], t[i])) return !1;
		}
		return !0;
	}
	function Xr(e) {
		if (e ||= typeof document < "u" ? document : void 0, e === void 0) return null;
		try {
			return e.activeElement || e.body;
		} catch {
			return e.body;
		}
	}
	function Zr(e) {
		for (; e && e.firstChild;) e = e.firstChild;
		return e;
	}
	function Qr(e, t) {
		var n = Zr(e);
		e = 0;
		for (var r; n;) {
			if (n.nodeType === 3) {
				if (r = e + n.textContent.length, e <= t && r >= t) return {
					node: n,
					offset: t - e
				};
				e = r;
			}
			a: {
				for (; n;) {
					if (n.nextSibling) {
						n = n.nextSibling;
						break a;
					}
					n = n.parentNode;
				}
				n = void 0;
			}
			n = Zr(n);
		}
	}
	function $r(e, t) {
		return e && t ? e === t ? !0 : e && e.nodeType === 3 ? !1 : t && t.nodeType === 3 ? $r(e, t.parentNode) : "contains" in e ? e.contains(t) : e.compareDocumentPosition ? !!(e.compareDocumentPosition(t) & 16) : !1 : !1;
	}
	function ei(e) {
		e = e != null && e.ownerDocument != null && e.ownerDocument.defaultView != null ? e.ownerDocument.defaultView : window;
		for (var t = Xr(e.document); t instanceof e.HTMLIFrameElement;) {
			try {
				var n = typeof t.contentWindow.location.href == "string";
			} catch {
				n = !1;
			}
			if (n) e = t.contentWindow;
			else break;
			t = Xr(e.document);
		}
		return t;
	}
	function ti(e) {
		var t = e && e.nodeName && e.nodeName.toLowerCase();
		return t && (t === "input" && (e.type === "text" || e.type === "search" || e.type === "tel" || e.type === "url" || e.type === "password") || t === "textarea" || e.contentEditable === "true");
	}
	var ni = In && "documentMode" in document && 11 >= document.documentMode, ri = null, ii = null, ai = null, oi = !1;
	function si(e, t, n) {
		var r = n.window === n ? n.document : n.nodeType === 9 ? n : n.ownerDocument;
		oi || ri == null || ri !== Xr(r) || (r = ri, "selectionStart" in r && ti(r) ? r = {
			start: r.selectionStart,
			end: r.selectionEnd
		} : (r = (r.ownerDocument && r.ownerDocument.defaultView || window).getSelection(), r = {
			anchorNode: r.anchorNode,
			anchorOffset: r.anchorOffset,
			focusNode: r.focusNode,
			focusOffset: r.focusOffset
		}), ai && Yr(ai, r) || (ai = r, r = cp(ii, "onSelect"), 0 < r.length && (t = new M("onSelect", "select", null, t, n), e.push({
			event: t,
			listeners: r
		}), t.target = ri)));
	}
	function ci(e, t) {
		var n = {};
		return n[e.toLowerCase()] = t.toLowerCase(), n["Webkit" + e] = "webkit" + t, n["Moz" + e] = "moz" + t, n;
	}
	var li = {
		animationend: ci("Animation", "AnimationEnd"),
		animationiteration: ci("Animation", "AnimationIteration"),
		animationstart: ci("Animation", "AnimationStart"),
		transitionrun: ci("Transition", "TransitionRun"),
		transitionstart: ci("Transition", "TransitionStart"),
		transitioncancel: ci("Transition", "TransitionCancel"),
		transitionend: ci("Transition", "TransitionEnd")
	}, ui = {}, di = {};
	In && (di = document.createElement("div").style, "AnimationEvent" in window || (delete li.animationend.animation, delete li.animationiteration.animation, delete li.animationstart.animation), "TransitionEvent" in window || delete li.transitionend.transition);
	function fi(e) {
		if (ui[e]) return ui[e];
		if (!li[e]) return e;
		var t = li[e], n;
		for (n in t) if (t.hasOwnProperty(n) && n in di) return ui[e] = t[n];
		return e;
	}
	var pi = fi("animationend"), mi = fi("animationiteration"), hi = fi("animationstart"), gi = fi("transitionrun"), _i = fi("transitionstart"), vi = fi("transitioncancel"), yi = fi("transitionend"), bi = /* @__PURE__ */ new Map(), xi = "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error fullscreenChange fullscreenError gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
	xi.push("scrollEnd");
	function Si(e, t) {
		bi.set(e, t), Yt(t, [e]);
	}
	var Ci = 0;
	function wi(e, t) {
		if (e.name != null && e.name !== "auto") return e.name;
		if (t.autoName !== null) return t.autoName;
		e = Nd.identifierPrefix;
		var n = Ci++;
		return e = "_" + e + "t_" + n.toString(32) + "_", t.autoName = e;
	}
	function Ti(e) {
		if (e == null || typeof e == "string") return e;
		var t = null, n = Vd;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = e[n[r]];
			if (i != null) {
				if (i === "none") return "none";
				t = t == null ? i : t + (" " + i);
			}
		}
		return t ?? e.default;
	}
	function Ei(e, t) {
		return e = Ti(e), t = Ti(t), t == null ? e === "auto" ? null : e : t === "auto" ? null : t;
	}
	var Di = typeof reportError == "function" ? reportError : function(e) {
		if (typeof window == "object" && typeof window.ErrorEvent == "function") {
			var t = new window.ErrorEvent("error", {
				bubbles: !0,
				cancelable: !0,
				message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
				error: e
			});
			if (!window.dispatchEvent(t)) return;
		} else if (typeof process == "object" && typeof process.emit == "function") {
			process.emit("uncaughtException", e);
			return;
		}
		console.error(e);
	}, Oi = [], ki = 0, Ai = 0;
	function ji() {
		for (var e = ki, t = Ai = ki = 0; t < e;) {
			var n = Oi[t];
			Oi[t++] = null;
			var r = Oi[t];
			Oi[t++] = null;
			var i = Oi[t];
			Oi[t++] = null;
			var a = Oi[t];
			if (Oi[t++] = null, r !== null && i !== null) {
				var o = r.pending;
				o === null ? i.next = i : (i.next = o.next, o.next = i), r.pending = i;
			}
			a !== 0 && Fi(n, i, a);
		}
	}
	function Mi(e, t, n, r) {
		Oi[ki++] = e, Oi[ki++] = t, Oi[ki++] = n, Oi[ki++] = r, Ai |= r, e.lanes |= r, e = e.alternate, e !== null && (e.lanes |= r);
	}
	function Ni(e, t, n, r) {
		return Mi(e, t, n, r), Ii(e);
	}
	function Pi(e, t) {
		return Mi(e, null, null, t), Ii(e);
	}
	function Fi(e, t, n) {
		e.lanes |= n;
		var r = e.alternate;
		r !== null && (r.lanes |= n);
		for (var i = !1, a = e.return; a !== null;) a.childLanes |= n, r = a.alternate, r !== null && (r.childLanes |= n), a.tag === 22 && (e = a.stateNode, e === null || e._visibility & 1 || (i = !0)), e = a, a = a.return;
		return e.tag === 3 ? (a = e.stateNode, i && t !== null && (i = 31 - st(n), e = a.hiddenUpdates, r = e[i], r === null ? e[i] = [t] : r.push(t), t.lane = n | 536870912), a) : null;
	}
	function Ii(e) {
		if (50 < Hd) throw Hd = 0, Ud = null, Error(i(185));
		for (var t = e.return; t !== null;) e = t, t = e.return;
		return e.tag === 3 ? e.stateNode : null;
	}
	var Li = {};
	function Ri(e, t, n, r) {
		this.tag = e, this.key = n, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = t, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = r, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
	}
	function zi(e, t, n, r) {
		return new Ri(e, t, n, r);
	}
	function Bi(e) {
		return e = e.prototype, !(!e || !e.isReactComponent);
	}
	function Vi(e, t) {
		var n = e.alternate;
		return n === null ? (n = zi(e.tag, t, e.key, e.mode), n.elementType = e.elementType, n.type = e.type, n.stateNode = e.stateNode, n.alternate = e, e.alternate = n) : (n.pendingProps = t, n.type = e.type, n.flags = 0, n.subtreeFlags = 0, n.deletions = null), n.flags = e.flags & 1206910976, n.childLanes = e.childLanes, n.lanes = e.lanes, n.child = e.child, n.memoizedProps = e.memoizedProps, n.memoizedState = e.memoizedState, n.updateQueue = e.updateQueue, t = e.dependencies, n.dependencies = t === null ? null : {
			lanes: t.lanes,
			firstContext: t.firstContext
		}, n.sibling = e.sibling, n.index = e.index, n.ref = e.ref, n.refCleanup = e.refCleanup, n;
	}
	function Hi(e, t) {
		e.flags &= 1206910978;
		var n = e.alternate;
		return n === null ? (e.childLanes = 0, e.lanes = t, e.child = null, e.subtreeFlags = 0, e.memoizedProps = null, e.memoizedState = null, e.updateQueue = null, e.dependencies = null, e.stateNode = null) : (e.childLanes = n.childLanes, e.lanes = n.lanes, e.child = n.child, e.subtreeFlags = 0, e.deletions = null, e.memoizedProps = n.memoizedProps, e.memoizedState = n.memoizedState, e.updateQueue = n.updateQueue, e.type = n.type, t = n.dependencies, e.dependencies = t === null ? null : {
			lanes: t.lanes,
			firstContext: t.firstContext
		}), e;
	}
	function Ui(e, t, n, r, a, o) {
		var s = 0;
		if (r = e, typeof r == "function") Bi(r) && (s = 1);
		else if (typeof r == "string") s = oh(e, n, ke.current) ? 26 : e === "html" || e === "head" || e === "body" ? 27 : 5;
		else a: switch (r) {
			case fe: return e = zi(31, n, t, a), e.elementType = fe, e.lanes = o, e;
			case ne: return Wi(n.children, a, o, t);
			case re:
				s = 8, a |= 24;
				break;
			case ie: return e = zi(12, n, t, a | 2), e.elementType = ie, e.lanes = o, e;
			case ce: return e = zi(13, n, t, a), e.elementType = ce, e.lanes = o, e;
			case le: return e = zi(19, n, t, a), e.elementType = le, e.lanes = o, e;
			case pe:
			case he: return e = a | 32, e = zi(30, n, t, e), e.elementType = he, e.lanes = o, e.stateNode = {
				autoName: null,
				paired: null,
				clones: null,
				ref: null
			}, e;
			default:
				if (typeof r == "object" && r) switch (r.$$typeof) {
					case oe:
						s = 10;
						break a;
					case ae:
						s = 9;
						break a;
					case se:
						s = 11;
						break a;
					case ue:
						s = 14;
						break a;
					case de:
						s = 16, r = null;
						break a;
				}
				s = 29, n = Error(i(130, e === null ? "null" : typeof e, "")), r = null;
		}
		return t = zi(s, n, t, a), t.elementType = e, t.type = r, t.lanes = o, t;
	}
	function Wi(e, t, n, r) {
		return e = zi(7, e, r, t), e.lanes = n, e;
	}
	function Gi(e, t, n) {
		return e = zi(6, e, null, t), e.lanes = n, e;
	}
	function Ki(e) {
		var t = zi(18, null, null, 0);
		return t.stateNode = e, t;
	}
	function qi(e, t, n) {
		return t = zi(4, e.children === null ? [] : e.children, e.key, t), t.lanes = n, t.stateNode = {
			containerInfo: e.containerInfo,
			pendingChildren: null,
			implementation: e.implementation
		}, t;
	}
	var Ji = /* @__PURE__ */ new WeakMap();
	function N(e, t) {
		if (typeof e == "object" && e) {
			var n = Ji.get(e);
			return n === void 0 ? (t = {
				value: e,
				source: t,
				stack: Ue(t)
			}, Ji.set(e, t), t) : n;
		}
		return {
			value: e,
			source: t,
			stack: Ue(t)
		};
	}
	var Yi = [], Xi = 0, Zi = null, Qi = 0, $i = [], ea = 0, ta = null, na = 1, ra = "";
	function P(e, t) {
		Yi[Xi++] = Qi, Yi[Xi++] = Zi, Zi = e, Qi = t;
	}
	function ia(e, t, n) {
		$i[ea++] = na, $i[ea++] = ra, $i[ea++] = ta, ta = e;
		var r = na;
		e = ra;
		var i = 32 - st(r) - 1;
		r &= ~(1 << i), n += 1;
		var a = 32 - st(t) + i;
		if (30 < a) {
			var o = i - i % 5;
			a = (r & (1 << o) - 1).toString(32), r >>= o, i -= o, na = 1 << 32 - st(t) + i | n << i | r, ra = a + e;
		} else na = 1 << a | n << i | r, ra = e;
	}
	function F(e) {
		e.return !== null && (P(e, 1), ia(e, 1, 0));
	}
	function aa(e) {
		for (; e === Zi;) Zi = Yi[--Xi], Yi[Xi] = null, Qi = Yi[--Xi], Yi[Xi] = null;
		for (; e === ta;) ta = $i[--ea], $i[ea] = null, ra = $i[--ea], $i[ea] = null, na = $i[--ea], $i[ea] = null;
	}
	function oa(e, t) {
		$i[ea++] = na, $i[ea++] = ra, $i[ea++] = ta, na = t.id, ra = t.overflow, ta = e;
	}
	var sa = null, ca = null, I = !1, la = null, ua = !1, da = Error(i(519));
	function fa(e) {
		throw va(N(Error(i(418, 1 < arguments.length && arguments[1] !== void 0 && arguments[1] ? "text" : "HTML", "")), e)), da;
	}
	function pa(e) {
		var t = e.stateNode, n = e.type, r = e.memoizedProps;
		switch (t[jt] = e, t[Mt] = r, n) {
			case "dialog":
				R("cancel", t), R("close", t);
				break;
			case "iframe":
			case "object":
			case "embed":
				R("load", t);
				break;
			case "video":
			case "audio":
				for (n = 0; n < $f.length; n++) R($f[n], t);
				break;
			case "source":
				R("error", t);
				break;
			case "img":
			case "image":
			case "link":
				R("error", t), R("load", t);
				break;
			case "details":
				R("toggle", t);
				break;
			case "input":
				R("invalid", t), mn(t, r.value, r.defaultValue, r.checked, r.defaultChecked, r.type, r.name, !0);
				break;
			case "select":
				R("invalid", t);
				break;
			case "textarea": R("invalid", t), vn(t, r.value, r.defaultValue, r.children);
		}
		n = r.children, typeof n != "string" && typeof n != "number" && typeof n != "bigint" || t.textContent === "" + n || !0 === r.suppressHydrationWarning || mp(t.textContent, n) ? (r.popover != null && (R("beforetoggle", t), R("toggle", t)), r.onScroll != null && R("scroll", t), r.onScrollEnd != null && R("scrollend", t), r.onClick != null && (t.onclick = Dn), t = !0) : t = !1, t || fa(e, !0);
	}
	function ma(e) {
		for (sa = e.return; sa;) switch (sa.tag) {
			case 5:
			case 31:
			case 13:
				ua = !1;
				return;
			case 27:
			case 3:
				ua = !0;
				return;
			default: sa = sa.return;
		}
	}
	function ha(e) {
		if (e !== sa) return !1;
		if (!I) return ma(e), I = !0, !1;
		var t = e.tag, n;
		if ((n = t !== 3 && t !== 27) && ((n = t === 5) && (n = e.type, n = n === "form" || n === "button" || Op(e.type, e.memoizedProps)), n = !n), n && ca && fa(e), ma(e), t === 13) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(i(317));
			ca = Em(e);
		} else if (t === 31) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(i(317));
			ca = Em(e);
		} else t === 27 ? (t = ca, Lp(e.type) ? (e = Tm, Tm = null, ca = e) : ca = t) : ca = sa ? wm(e.stateNode.nextSibling) : null;
		return !0;
	}
	function ga() {
		ca = sa = null, I = !1;
	}
	function _a() {
		var e = la;
		return e !== null && (Td === null ? Td = e : Td.push.apply(Td, e), la = null), e;
	}
	function va(e) {
		la === null ? la = [e] : la.push(e);
	}
	var ya = Ee(null), ba = null, xa = null;
	function Sa(e, t, n) {
		Oe(ya, t._currentValue), t._currentValue = n;
	}
	function Ca(e) {
		e._currentValue = ya.current, De(ya);
	}
	function wa(e, t, n) {
		for (; e !== null;) {
			var r = e.alternate;
			if ((e.childLanes & t) === t ? r !== null && (r.childLanes & t) !== t && (r.childLanes |= t) : (e.childLanes |= t, r !== null && (r.childLanes |= t)), e === n) break;
			e = e.return;
		}
	}
	function Ta(e, t, n, r) {
		var a = e.child;
		for (a !== null && (a.return = e); a !== null;) {
			var o = a.dependencies;
			if (o !== null) {
				var s = a.child;
				o = o.firstContext;
				a: for (; o !== null;) {
					var c = o;
					o = a;
					for (var l = 0; l < t.length; l++) if (c.context === t[l]) {
						o.lanes |= n, c = o.alternate, c !== null && (c.lanes |= n), wa(o.return, n, e), r || (s = null);
						break a;
					}
					o = c.next;
				}
			} else if (a.tag === 18) {
				if (s = a.return, s === null) throw Error(i(341));
				s.lanes |= n, o = s.alternate, o !== null && (o.lanes |= n), wa(s, n, e), s = null;
			} else a.tag === 13 && a.memoizedState !== null && a.memoizedState.dehydrated === null ? (a.lanes |= n, s = a.alternate, s !== null && (s.lanes |= n), wa(a.return, n, e), s = a.child, s = s === null ? null : s.sibling) : s = a.child;
			if (s !== null) s.return = a;
			else for (s = a; s !== null;) {
				if (s === e) {
					s = null;
					break;
				}
				if (a = s.sibling, a !== null) {
					a.return = s.return, s = a;
					break;
				}
				s = s.return;
			}
			a = s;
		}
	}
	function Ea(e, t, n, r) {
		e = null;
		for (var a = t, o = !1; a !== null;) {
			if (!o) {
				if (a.flags & 524288) o = !0;
				else if (a.flags & 262144) break;
			}
			if (a.tag === 10) {
				var s = a.alternate;
				if (s === null) throw Error(i(387));
				if (s = s.memoizedProps, s !== null) {
					var c = a.type;
					Jr(a.pendingProps.value, s.value) || (e === null ? e = [c] : e.push(c));
				}
			} else if (a === Me.current) {
				if (s = a.alternate, s === null) throw Error(i(387));
				s.memoizedState.memoizedState !== a.memoizedState.memoizedState && (e === null ? e = [bh] : e.push(bh));
			}
			a = a.return;
		}
		return e !== null && Ta(t, e, n, r), t.flags |= 262144, e !== null;
	}
	function Da(e) {
		for (e = e.firstContext; e !== null;) {
			if (!Jr(e.context._currentValue, e.memoizedValue)) return !0;
			e = e.next;
		}
		return !1;
	}
	function Oa(e) {
		ba = e, xa = null, e = e.dependencies, e !== null && (e.firstContext = null);
	}
	function ka(e) {
		return ja(ba, e);
	}
	function Aa(e, t) {
		return ba === null && Oa(e), ja(e, t);
	}
	function ja(e, t) {
		var n = t._currentValue;
		if (t = {
			context: t,
			memoizedValue: n,
			next: null
		}, xa === null) {
			if (e === null) throw Error(i(308));
			xa = t, e.dependencies = {
				lanes: 0,
				firstContext: t
			}, e.flags |= 524288;
		} else xa = xa.next = t;
		return n;
	}
	var Ma = typeof AbortController < "u" ? AbortController : function() {
		var e = [], t = this.signal = {
			aborted: !1,
			addEventListener: function(t, n) {
				e.push(n);
			}
		};
		this.abort = function() {
			t.aborted = !0, e.forEach(function(e) {
				return e();
			});
		};
	}, Na = t.unstable_scheduleCallback, Pa = t.unstable_NormalPriority, Fa = {
		$$typeof: oe,
		Consumer: null,
		Provider: null,
		_currentValue: null,
		_currentValue2: null,
		_threadCount: 0
	};
	function Ia() {
		return {
			controller: new Ma(),
			data: /* @__PURE__ */ new Map(),
			refCount: 0
		};
	}
	function La(e) {
		e.refCount--, e.refCount === 0 && Na(Pa, function() {
			e.controller.abort();
		});
	}
	function Ra(e, t) {
		if (e.pendingLanes & 4194048) {
			var n = e.transitionTypes;
			for (n === null && (n = e.transitionTypes = []), e = 0; e < t.length; e++) {
				var r = t[e];
				n.indexOf(r) === -1 && n.push(r);
			}
		}
	}
	var za = null;
	function Ba(e) {
		var t = e.transitionTypes;
		return e.transitionTypes = null, t;
	}
	var Va = null, Ha = 0, Ua = 0, Wa = null;
	function Ga(e, t) {
		if (Va === null) {
			var n = Va = [];
			Ha = 0, Ua = Jf(), Wa = {
				status: "pending",
				value: void 0,
				then: function(e) {
					n.push(e);
				}
			};
		}
		return Ha++, t.then(Ka, Ka), t;
	}
	function Ka() {
		if (--Ha === 0 && (za = null, Va !== null)) {
			Wa !== null && (Wa.status = "fulfilled");
			var e = Va;
			Va = null, Ua = 0, Wa = null;
			for (var t = 0; t < e.length; t++) (0, e[t])();
		}
	}
	function qa(e, t) {
		var n = [], r = {
			status: "pending",
			value: null,
			reason: null,
			then: function(e) {
				n.push(e);
			}
		};
		return e.then(function() {
			r.status = "fulfilled", r.value = t;
			for (var e = 0; e < n.length; e++) (0, n[e])(t);
		}, function(e) {
			for (r.status = "rejected", r.reason = e, e = 0; e < n.length; e++) (0, n[e])(void 0);
		}), r;
	}
	var Ja = k.S;
	k.S = function(e, t) {
		if (Od = Ye(), typeof t == "object" && t && typeof t.then == "function" && Ga(e, t), za !== null) for (var n = Pf; n !== null;) Ra(n, za), n = n.next;
		if (n = e.types, n !== null) {
			for (var r = Pf; r !== null;) Ra(r, n), r = r.next;
			if (Ua !== 0) {
				r = za, r === null && (r = za = []);
				for (var i = 0; i < n.length; i++) {
					var a = n[i];
					r.indexOf(a) === -1 && r.push(a);
				}
			}
		}
		Ja !== null && Ja(e, t);
	};
	var Ya = Ee(null);
	function Xa() {
		var e = Ya.current;
		return e === null ? ld.pooledCache : e;
	}
	function Za(e, t) {
		t === null ? Oe(Ya, Ya.current) : Oe(Ya, t.pool);
	}
	function Qa() {
		var e = Xa();
		return e === null ? null : {
			parent: Fa._currentValue,
			pool: e
		};
	}
	var $a = Error(i(460)), eo = Error(i(474)), to = Error(i(542)), no = { then: function() {} };
	function ro(e) {
		return e = e.status, e === "fulfilled" || e === "rejected";
	}
	function io(e, t, n) {
		switch (n = e[n], n === void 0 ? e.push(t) : n !== t && (t.then(Dn, Dn), t = n), t.status) {
			case "fulfilled": return t.value;
			case "rejected": throw e = t.reason, co(e), e === void 0 && !("reason" in t) ? Error(i(600)) : e;
			default:
				if (typeof t.status == "string") t.then(Dn, Dn);
				else {
					if (e = ld, e !== null && 100 < e.shellSuspendCounter) throw Error(i(482));
					e = t, e.status = "pending", e.then(function(e) {
						if (t.status === "pending") {
							var n = t;
							n.status = "fulfilled", n.value = e;
						}
					}, function(e) {
						if (t.status === "pending") {
							var n = t;
							n.status = "rejected", n.reason = e;
						}
					});
				}
				switch (t.status) {
					case "fulfilled": return t.value;
					case "rejected": throw e = t.reason, co(e), e;
				}
				throw oo = t, $a;
		}
	}
	function ao(e) {
		try {
			var t = e._init;
			return t(e._payload);
		} catch (e) {
			throw typeof e == "object" && e && typeof e.then == "function" ? (oo = e, $a) : e;
		}
	}
	var oo = null;
	function so() {
		if (oo === null) throw Error(i(459));
		var e = oo;
		return oo = null, e;
	}
	function co(e) {
		if (e === $a || e === to) throw Error(i(483));
	}
	var lo = null, uo = 0;
	function fo(e) {
		var t = uo;
		return uo += 1, lo === null && (lo = []), io(lo, e, t);
	}
	function po(e, t) {
		t = t.props.ref, e.ref = t === void 0 ? null : t;
	}
	function mo(e, t) {
		throw t.$$typeof === te ? Error(i(525)) : (e = Object.prototype.toString.call(t), Error(i(31, e === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : e)));
	}
	function ho(e) {
		function t(t, n) {
			if (e) {
				var r = t.deletions;
				r === null ? (t.deletions = [n], t.flags |= 16) : r.push(n);
			}
		}
		function n(n, r) {
			if (!e) return null;
			for (; r !== null;) t(n, r), r = r.sibling;
			return null;
		}
		function r(e) {
			for (var t = /* @__PURE__ */ new Map(); e !== null;) e.key === null ? t.set(e.index, e) : t.set(e.key, e), e = e.sibling;
			return t;
		}
		function a(e, t) {
			return e = Vi(e, t), e.index = 0, e.sibling = null, e;
		}
		function o(t, n, r) {
			return t.index = r, e ? (r = t.alternate, r === null ? (t.flags |= 134217730, n) : (r = r.index, r < n ? (t.flags |= 2, n) : r)) : (t.flags |= 1048576, n);
		}
		function s(t) {
			return e && t.alternate === null && (t.flags |= 134217730), t;
		}
		function c(e, t, n, r) {
			return t === null || t.tag !== 6 ? (t = Gi(n, e.mode, r), t.return = e, t) : (t = a(t, n), t.return = e, t);
		}
		function l(e, t, n, r) {
			var i = n.type;
			return i === ne ? (e = d(e, t, n.props.children, r, n.key), po(e, n), e) : t !== null && (t.elementType === i || typeof i == "object" && i && i.$$typeof === de && ao(i) === t.type) ? (t = a(t, n.props), po(t, n), t.return = e, t) : (t = Ui(n.type, n.key, n.props, null, e.mode, r), po(t, n), t.return = e, t);
		}
		function u(e, t, n, r) {
			return t === null || t.tag !== 4 || t.stateNode.containerInfo !== n.containerInfo || t.stateNode.implementation !== n.implementation ? (t = qi(n, e.mode, r), t.return = e, t) : (t = a(t, n.children || []), t.return = e, t);
		}
		function d(e, t, n, r, i) {
			return t === null || t.tag !== 7 ? (t = Wi(n, e.mode, r, i), t.return = e, t) : (t = a(t, n), t.return = e, t);
		}
		function f(e, t, n) {
			if (typeof t == "string" && t !== "" || typeof t == "number" || typeof t == "bigint") return t = Gi("" + t, e.mode, n), t.return = e, t;
			if (typeof t == "object" && t) {
				switch (t.$$typeof) {
					case D: return n = Ui(t.type, t.key, t.props, null, e.mode, n), po(n, t), n.return = e, n;
					case O: return t = qi(t, e.mode, n), t.return = e, t;
					case de: return t = ao(t), f(e, t, n);
				}
				if (xe(t) || ve(t)) return t = Wi(t, e.mode, n, null), t.return = e, t;
				if (typeof t.then == "function") return f(e, fo(t), n);
				if (t.$$typeof === oe) return f(e, Aa(e, t), n);
				mo(e, t);
			}
			return null;
		}
		function p(e, t, n, r) {
			var i = t === null ? null : t.key;
			if (typeof n == "string" && n !== "" || typeof n == "number" || typeof n == "bigint") return i === null ? c(e, t, "" + n, r) : null;
			if (typeof n == "object" && n) {
				switch (n.$$typeof) {
					case D: return n.key === i ? l(e, t, n, r) : null;
					case O: return n.key === i ? u(e, t, n, r) : null;
					case de: return n = ao(n), p(e, t, n, r);
				}
				if (xe(n) || ve(n)) return i === null ? d(e, t, n, r, null) : null;
				if (typeof n.then == "function") return p(e, t, fo(n), r);
				if (n.$$typeof === oe) return p(e, t, Aa(e, n), r);
				mo(e, n);
			}
			return null;
		}
		function m(e, t, n, r, i) {
			if (typeof r == "string" && r !== "" || typeof r == "number" || typeof r == "bigint") return e = e.get(n) || null, c(t, e, "" + r, i);
			if (typeof r == "object" && r) {
				switch (r.$$typeof) {
					case D: return e = e.get(r.key === null ? n : r.key) || null, l(t, e, r, i);
					case O: return e = e.get(r.key === null ? n : r.key) || null, u(t, e, r, i);
					case de: return r = ao(r), m(e, t, n, r, i);
				}
				if (xe(r) || ve(r)) return e = e.get(n) || null, d(t, e, r, i, null);
				if (typeof r.then == "function") return m(e, t, n, fo(r), i);
				if (r.$$typeof === oe) return m(e, t, n, Aa(t, r), i);
				mo(t, r);
			}
			return null;
		}
		function h(i, a, s, c) {
			for (var l = null, u = null, d = a, h = a = 0, g = null; d !== null && h < s.length; h++) {
				d.index > h ? (g = d, d = null) : g = d.sibling;
				var _ = p(i, d, s[h], c);
				if (_ === null) {
					d === null && (d = g);
					break;
				}
				e && d && _.alternate === null && t(i, d), a = o(_, a, h), u === null ? l = _ : u.sibling = _, u = _, d = g;
			}
			if (h === s.length) return n(i, d), I && P(i, h), l;
			if (d === null) {
				for (; h < s.length; h++) d = f(i, s[h], c), d !== null && (a = o(d, a, h), u === null ? l = d : u.sibling = d, u = d);
				return I && P(i, h), l;
			}
			for (d = r(d); h < s.length; h++) g = m(d, i, h, s[h], c), g !== null && (e && (_ = g.alternate, _ !== null && d.delete(_.key === null ? h : _.key)), a = o(g, a, h), u === null ? l = g : u.sibling = g, u = g);
			return e && d.forEach(function(e) {
				return t(i, e);
			}), I && P(i, h), l;
		}
		function g(a, s, c, l) {
			if (c == null) throw Error(i(151));
			for (var u = null, d = null, h = s, g = s = 0, _ = null, v = c.next(); h !== null && !v.done; g++, v = c.next()) {
				h.index > g ? (_ = h, h = null) : _ = h.sibling;
				var y = p(a, h, v.value, l);
				if (y === null) {
					h === null && (h = _);
					break;
				}
				e && h && y.alternate === null && t(a, h), s = o(y, s, g), d === null ? u = y : d.sibling = y, d = y, h = _;
			}
			if (v.done) return n(a, h), I && P(a, g), u;
			if (h === null) {
				for (; !v.done; g++, v = c.next()) v = f(a, v.value, l), v !== null && (s = o(v, s, g), d === null ? u = v : d.sibling = v, d = v);
				return I && P(a, g), u;
			}
			for (h = r(h); !v.done; g++, v = c.next()) v = m(h, a, g, v.value, l), v !== null && (e && (_ = v.alternate, _ !== null && h.delete(_.key === null ? g : _.key)), s = o(v, s, g), d === null ? u = v : d.sibling = v, d = v);
			return e && h.forEach(function(e) {
				return t(a, e);
			}), I && P(a, g), u;
		}
		function _(e, r, o, c) {
			if (typeof o == "object" && o && o.type === ne && o.key === null && o.props.ref === void 0 && (o = o.props.children), typeof o == "object" && o) {
				switch (o.$$typeof) {
					case D:
						a: {
							for (var l = o.key; r !== null;) {
								if (r.key === l) {
									if (l = o.type, l === ne) {
										if (r.tag === 7) {
											n(e, r.sibling), c = a(r, o.props.children), po(c, o), c.return = e, e = c;
											break a;
										}
									} else if (r.elementType === l || typeof l == "object" && l && l.$$typeof === de && ao(l) === r.type) {
										n(e, r.sibling), c = a(r, o.props), po(c, o), c.return = e, e = c;
										break a;
									}
									n(e, r);
									break;
								}
								t(e, r), r = r.sibling;
							}
							o.type === ne ? (c = Wi(o.props.children, e.mode, c, o.key), po(c, o), c.return = e, e = c) : (c = Ui(o.type, o.key, o.props, null, e.mode, c), po(c, o), c.return = e, e = c);
						}
						return s(e);
					case O:
						a: {
							for (l = o.key; r !== null;) {
								if (r.key === l) {
									if (r.tag === 4 && r.stateNode.containerInfo === o.containerInfo && r.stateNode.implementation === o.implementation) {
										n(e, r.sibling), c = a(r, o.children || []), c.return = e, e = c;
										break a;
									}
									n(e, r);
									break;
								}
								t(e, r), r = r.sibling;
							}
							c = qi(o, e.mode, c), c.return = e, e = c;
						}
						return s(e);
					case de: return o = ao(o), _(e, r, o, c);
				}
				if (xe(o)) return h(e, r, o, c);
				if (ve(o)) {
					if (l = ve(o), typeof l != "function") throw Error(i(150));
					return o = l.call(o), g(e, r, o, c);
				}
				if (typeof o.then == "function") return _(e, r, fo(o), c);
				if (o.$$typeof === oe) return _(e, r, Aa(e, o), c);
				mo(e, o);
			}
			return typeof o == "string" && o !== "" || typeof o == "number" || typeof o == "bigint" ? (o = "" + o, r !== null && r.tag === 6 ? (n(e, r.sibling), c = a(r, o), c.return = e, e = c) : (n(e, r), c = Gi(o, e.mode, c), c.return = e, e = c), s(e)) : n(e, r);
		}
		return function(e, t, n, r) {
			try {
				uo = 0;
				var i = _(e, t, n, r);
				return lo = null, i;
			} catch (t) {
				if (t === $a || t === to) throw t;
				var a = zi(29, t, null, e.mode);
				return a.lanes = r, a.return = e, a;
			}
		};
	}
	var go = ho(!0), _o = ho(!1), vo = !1;
	function yo(e) {
		e.updateQueue = {
			baseState: e.memoizedState,
			firstBaseUpdate: null,
			lastBaseUpdate: null,
			shared: {
				pending: null,
				lanes: 0,
				hiddenCallbacks: null
			},
			callbacks: null
		};
	}
	function bo(e, t) {
		e = e.updateQueue, t.updateQueue === e && (t.updateQueue = {
			baseState: e.baseState,
			firstBaseUpdate: e.firstBaseUpdate,
			lastBaseUpdate: e.lastBaseUpdate,
			shared: e.shared,
			callbacks: null
		});
	}
	function xo(e) {
		return {
			lane: e,
			tag: 0,
			payload: null,
			callback: null,
			next: null
		};
	}
	function So(e, t, n) {
		var r = e.updateQueue;
		if (r === null) return null;
		if (r = r.shared, cd & 2) {
			var i = r.pending;
			return i === null ? t.next = t : (t.next = i.next, i.next = t), r.pending = t, t = Ii(e), Fi(e, null, n), t;
		}
		return Mi(e, r, t, n), Ii(e);
	}
	function Co(e, t, n) {
		if (t = t.updateQueue, t !== null && (t = t.shared, n & 4194048)) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, wt(e, n);
		}
	}
	function wo(e, t) {
		var n = e.updateQueue, r = e.alternate;
		if (r !== null && (r = r.updateQueue, n === r)) {
			var i = null, a = null;
			if (n = n.firstBaseUpdate, n !== null) {
				do {
					var o = {
						lane: n.lane,
						tag: n.tag,
						payload: n.payload,
						callback: null,
						next: null
					};
					a === null ? i = a = o : a = a.next = o, n = n.next;
				} while (n !== null);
				a === null ? i = a = t : a = a.next = t;
			} else i = a = t;
			n = {
				baseState: r.baseState,
				firstBaseUpdate: i,
				lastBaseUpdate: a,
				shared: r.shared,
				callbacks: r.callbacks
			}, e.updateQueue = n;
			return;
		}
		e = n.lastBaseUpdate, e === null ? n.firstBaseUpdate = t : e.next = t, n.lastBaseUpdate = t;
	}
	var To = !1;
	function Eo() {
		if (To) {
			var e = Wa;
			if (e !== null) throw e;
		}
	}
	function Do(e, t, n, r) {
		To = !1;
		var i = e.updateQueue;
		vo = !1;
		var a = i.firstBaseUpdate, o = i.lastBaseUpdate, s = i.shared.pending;
		if (s !== null) {
			i.shared.pending = null;
			var c = s, l = c.next;
			c.next = null, o === null ? a = l : o.next = l, o = c;
			var u = e.alternate;
			u !== null && (u = u.updateQueue, s = u.lastBaseUpdate, s !== o && (s === null ? u.firstBaseUpdate = l : s.next = l, u.lastBaseUpdate = c));
		}
		if (a !== null) {
			var d = i.baseState;
			o = 0, u = l = c = null, s = a;
			do {
				var f = s.lane & -536870913, p = f !== s.lane;
				if (p ? (dd & f) === f : (r & f) === f) {
					f !== 0 && f === Ua && (To = !0), u !== null && (u = u.next = {
						lane: 0,
						tag: s.tag,
						payload: s.payload,
						callback: null,
						next: null
					});
					a: {
						var m = e, h = s;
						f = t;
						var g = n;
						switch (h.tag) {
							case 1:
								if (m = h.payload, typeof m == "function") {
									d = m.call(g, d, f);
									break a;
								}
								d = m;
								break a;
							case 3: m.flags = m.flags & -65537 | 128;
							case 0:
								if (m = h.payload, f = typeof m == "function" ? m.call(g, d, f) : m, f == null) break a;
								d = E({}, d, f);
								break a;
							case 2: vo = !0;
						}
					}
					f = s.callback, f !== null && (e.flags |= 64, p && (e.flags |= 8192), p = i.callbacks, p === null ? i.callbacks = [f] : p.push(f));
				} else p = {
					lane: f,
					tag: s.tag,
					payload: s.payload,
					callback: s.callback,
					next: null
				}, u === null ? (l = u = p, c = d) : u = u.next = p, o |= f;
				if (s = s.next, s === null) {
					if (s = i.shared.pending, s === null) break;
					p = s, s = p.next, p.next = null, i.lastBaseUpdate = p, i.shared.pending = null;
				}
			} while (1);
			u === null && (c = d), i.baseState = c, i.firstBaseUpdate = l, i.lastBaseUpdate = u, a === null && (i.shared.lanes = 0), yd |= o, e.lanes = o, e.memoizedState = d;
		}
	}
	function Oo(e, t) {
		if (typeof e != "function") throw Error(i(191, e));
		e.call(t);
	}
	function ko(e, t) {
		var n = e.callbacks;
		if (n !== null) for (e.callbacks = null, e = 0; e < n.length; e++) Oo(n[e], t);
	}
	var Ao = Ee(null), jo = Ee(0);
	function Mo(e, t) {
		e = _d, Oe(jo, e), Oe(Ao, t), _d = e | t.baseLanes;
	}
	function No() {
		Oe(jo, _d), Oe(Ao, Ao.current);
	}
	function Po() {
		_d = jo.current, De(Ao), De(jo);
	}
	var Fo = Ee(null), Io = null;
	function Lo(e) {
		var t = e.alternate;
		Oe(Ho, Ho.current & 1), Oe(Fo, e), Io === null && (t === null || Ao.current !== null || t.memoizedState !== null) && (Io = e);
	}
	function Ro(e) {
		Oe(Ho, Ho.current), Oe(Fo, e), Io === null && (Io = e);
	}
	function zo(e) {
		e.tag === 22 ? (Oe(Ho, Ho.current), Oe(Fo, e), Io === null && (Io = e)) : Bo();
	}
	function Bo() {
		Oe(Ho, Ho.current), Oe(Fo, Fo.current);
	}
	function Vo(e) {
		De(Fo), Io === e && (Io = null), De(Ho);
	}
	var Ho = Ee(0);
	function Uo(e, t) {
		Oe(Fo, Fo.current), Oe(Ho, t);
	}
	function Wo(e) {
		De(Ho), De(Fo), Io === e && (Io = null);
	}
	function Go(e) {
		for (var t = e; t !== null;) {
			if (t.tag === 13) {
				var n = t.memoizedState;
				if (n !== null && (n = n.dehydrated, n === null || xm(n) || Sm(n))) return t;
			} else if (t.tag === 19 && t.memoizedProps.revealOrder !== "independent") {
				if (t.flags & 128) return t;
			} else if (t.child !== null) {
				t.child.return = t, t = t.child;
				continue;
			}
			if (t === e) break;
			for (; t.sibling === null;) {
				if (t.return === null || t.return === e) return null;
				t = t.return;
			}
			t.sibling.return = t.return, t = t.sibling;
		}
		return null;
	}
	var Ko = 0, L = null, qo = null, Jo = null, Yo = !1, Xo = !1, Zo = !1, Qo = 0, $o = 0, es = null, ts = 0;
	function ns() {
		throw Error(i(321));
	}
	function rs(e, t) {
		if (t === null) return !1;
		for (var n = 0; n < t.length && n < e.length; n++) if (!Jr(e[n], t[n])) return !1;
		return !0;
	}
	function is(e, t, n, r, i, a) {
		return Ko = a, L = t, t.memoizedState = null, t.updateQueue = null, t.lanes = 0, k.H = e === null || e.memoizedState === null ? xc : Sc, Zo = !1, a = n(r, i), Zo = !1, Xo && (a = os(t, n, r, i)), as(e), a;
	}
	function as(e) {
		k.H = bc;
		var t = qo !== null && qo.next !== null;
		if (Ko = 0, Jo = qo = L = null, Yo = !1, $o = 0, es = null, t) throw Error(i(300));
		e === null || zc || (e = e.dependencies, e !== null && Da(e) && (zc = !0));
	}
	function os(e, t, n, r) {
		L = e;
		var a = 0;
		do {
			if (Xo && (es = null), $o = 0, Xo = !1, 25 <= a) throw Error(i(301));
			if (a += 1, Jo = qo = null, e.updateQueue != null) {
				var o = e.updateQueue;
				o.lastEffect = null, o.events = null, o.stores = null, o.memoCache != null && (o.memoCache.index = 0);
			}
			k.H = Cc, o = t(n, r);
		} while (Xo);
		return o;
	}
	function ss() {
		var e = k.H, t = e.useState()[0];
		return t = typeof t.then == "function" ? ms(t) : t, e = e.useState()[0], (qo === null ? null : qo.memoizedState) !== e && (L.flags |= 1024), t;
	}
	function cs() {
		var e = Qo !== 0;
		return Qo = 0, e;
	}
	function ls(e, t, n) {
		t.updateQueue = e.updateQueue, t.flags &= -2053, e.lanes &= ~n;
	}
	function us(e) {
		if (Yo) {
			for (e = e.memoizedState; e !== null;) {
				var t = e.queue;
				t !== null && (t.pending = null), e = e.next;
			}
			Yo = !1;
		}
		Ko = 0, Jo = qo = L = null, Xo = !1, $o = Qo = 0, es = null;
	}
	function ds() {
		var e = {
			memoizedState: null,
			baseState: null,
			baseQueue: null,
			queue: null,
			next: null
		};
		return Jo === null ? L.memoizedState = Jo = e : Jo = Jo.next = e, Jo;
	}
	function fs() {
		if (qo === null) {
			var e = L.alternate;
			e = e === null ? null : e.memoizedState;
		} else e = qo.next;
		var t = Jo === null ? L.memoizedState : Jo.next;
		if (t !== null) Jo = t, qo = e;
		else {
			if (e === null) throw L.alternate === null ? Error(i(467)) : Error(i(310));
			qo = e, e = {
				memoizedState: qo.memoizedState,
				baseState: qo.baseState,
				baseQueue: qo.baseQueue,
				queue: qo.queue,
				next: null
			}, Jo === null ? L.memoizedState = Jo = e : Jo = Jo.next = e;
		}
		return Jo;
	}
	function ps() {
		return {
			lastEffect: null,
			events: null,
			stores: null,
			memoCache: null
		};
	}
	function ms(e) {
		var t = $o;
		return $o += 1, es === null && (es = []), e = io(es, e, t), t = L, (Jo === null ? t.memoizedState : Jo.next) === null && (t = t.alternate, k.H = t === null || t.memoizedState === null ? xc : Sc), e;
	}
	function hs(e) {
		if (typeof e == "object" && e) {
			if (typeof e.then == "function") return ms(e);
			if (e.$$typeof === ge) return;
			if (e.$$typeof === oe) return ka(e);
		}
		throw Error(i(438, String(e)));
	}
	function gs(e) {
		var t = null, n = L.updateQueue;
		if (n !== null && (t = n.memoCache), t == null) {
			var r = L.alternate;
			r !== null && (r = r.updateQueue, r !== null && (r = r.memoCache, r != null && (t = {
				data: r.data.map(function(e) {
					return e.slice();
				}),
				index: 0
			})));
		}
		if (t ??= {
			data: [],
			index: 0
		}, n === null && (n = ps(), L.updateQueue = n), n.memoCache = t, n = t.data[t.index], n === void 0) for (n = t.data[t.index] = Array(e), r = 0; r < e; r++) n[r] = me;
		return t.index++, n;
	}
	function _s(e, t) {
		return typeof t == "function" ? t(e) : t;
	}
	function vs(e) {
		return ys(fs(), qo, e);
	}
	function ys(e, t, n) {
		var r = e.queue;
		if (r === null) throw Error(i(311));
		r.lastRenderedReducer = n;
		var a = e.baseQueue, o = r.pending;
		if (o !== null) {
			if (a !== null) {
				var s = a.next;
				a.next = o.next, o.next = s;
			}
			t.baseQueue = a = o, r.pending = null;
		}
		if (o = e.baseState, a === null) e.memoizedState = o;
		else {
			t = a.next;
			var c = s = null, l = null, u = t, d = !1;
			do {
				var f = u.lane & -536870913;
				if (f === u.lane ? (Ko & f) === f : (dd & f) === f) {
					var p = u.revertLane;
					if (p === 0) l !== null && (l = l.next = {
						lane: 0,
						revertLane: 0,
						gesture: null,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}), f === Ua && (d = !0);
					else if ((Ko & p) === p) {
						u = u.next, p === Ua && (d = !0);
						continue;
					} else f = {
						lane: 0,
						revertLane: u.revertLane,
						gesture: null,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}, l === null ? (c = l = f, s = o) : l = l.next = f, L.lanes |= p, yd |= p;
					f = u.action, Zo && n(o, f), o = u.hasEagerState ? u.eagerState : n(o, f);
				} else p = {
					lane: f,
					revertLane: u.revertLane,
					gesture: u.gesture,
					action: u.action,
					hasEagerState: u.hasEagerState,
					eagerState: u.eagerState,
					next: null
				}, l === null ? (c = l = p, s = o) : l = l.next = p, L.lanes |= f, yd |= f;
				u = u.next;
			} while (u !== null && u !== t);
			if (l === null ? s = o : l.next = c, !Jr(o, e.memoizedState) && (zc = !0, d && (n = Wa, n !== null))) throw n;
			e.memoizedState = o, e.baseState = s, e.baseQueue = l, r.lastRenderedState = o;
		}
		return a === null && (r.lanes = 0), [e.memoizedState, r.dispatch];
	}
	function bs(e) {
		var t = fs(), n = t.queue;
		if (n === null) throw Error(i(311));
		n.lastRenderedReducer = e;
		var r = n.dispatch, a = n.pending, o = t.memoizedState;
		if (a !== null) {
			n.pending = null;
			var s = a = a.next;
			do
				o = e(o, s.action), s = s.next;
			while (s !== a);
			Jr(o, t.memoizedState) || (zc = !0), t.memoizedState = o, t.baseQueue === null && (t.baseState = o), n.lastRenderedState = o;
		}
		return [o, r];
	}
	function xs(e, t, n) {
		var r = L, a = fs(), o = I;
		if (o) {
			if (n === void 0) throw Error(i(407));
			n = n();
		} else n = t();
		var s = !Jr((qo || a).memoizedState, n);
		if (s && (a.memoizedState = n, zc = !0), a = a.queue, Ks(ws.bind(null, r, a, e), [e]), e = a.getSnapshot !== t || s || Jo !== null && !!(Jo.memoizedState.tag & 1), Vs(e ? 9 : 8, { destroy: void 0 }, Cs.bind(null, r, a, n, t), null), e) {
			if (r.flags |= 2048, ld === null) throw Error(i(349));
			o || Ko & 127 || Ss(r, t, n);
		}
		return n;
	}
	function Ss(e, t, n) {
		e.flags |= 16384, e = {
			getSnapshot: t,
			value: n
		}, t = L.updateQueue, t === null ? (t = ps(), L.updateQueue = t, t.stores = [e]) : (n = t.stores, n === null ? t.stores = [e] : n.push(e));
	}
	function Cs(e, t, n, r) {
		t.value = n, t.getSnapshot = r, Ts(t) && Es(e);
	}
	function ws(e, t, n) {
		return n(function() {
			Ts(t) && Es(e);
		});
	}
	function Ts(e) {
		var t = e.getSnapshot;
		e = e.value;
		try {
			var n = t();
			return !Jr(e, n);
		} catch {
			return !0;
		}
	}
	function Es(e) {
		var t = Pi(e, 2);
		t !== null && qd(t, e, 2);
	}
	function Ds(e) {
		var t = ds();
		if (typeof e == "function") {
			var n = e;
			if (e = n(), Zo) {
				ot(!0);
				try {
					n();
				} finally {
					ot(!1);
				}
			}
		}
		return t.memoizedState = t.baseState = e, t.queue = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: _s,
			lastRenderedState: e
		}, t;
	}
	function Os(e, t, n, r) {
		return e.baseState = n, ys(e, qo, typeof r == "function" ? r : _s);
	}
	function ks(e, t, n, r, a) {
		if (_c(e)) throw Error(i(485));
		if (e = t.action, e !== null) {
			var o = {
				payload: a,
				action: e,
				next: null,
				isTransition: !0,
				status: "pending",
				value: null,
				reason: null,
				listeners: [],
				then: function(e) {
					o.listeners.push(e);
				}
			};
			k.T === null ? o.isTransition = !1 : n(!0), r(o), n = t.pending, n === null ? (o.next = t.pending = o, As(t, o)) : (o.next = n.next, t.pending = n.next = o);
		}
	}
	function As(e, t) {
		var n = t.action, r = t.payload, i = e.state;
		if (t.isTransition) {
			var a = k.T, o = {};
			o.types = a === null ? null : a.types, k.T = o;
			try {
				var s = n(i, r), c = k.S;
				c !== null && c(o, s), js(e, t, s);
			} catch (n) {
				Ns(e, t, n);
			} finally {
				a !== null && o.types !== null && (a.types = o.types), k.T = a;
			}
		} else try {
			a = n(i, r), js(e, t, a);
		} catch (n) {
			Ns(e, t, n);
		}
	}
	function js(e, t, n) {
		typeof n == "object" && n && typeof n.then == "function" ? n.then(function(n) {
			Ms(e, t, n);
		}, function(n) {
			return Ns(e, t, n);
		}) : Ms(e, t, n);
	}
	function Ms(e, t, n) {
		t.status = "fulfilled", t.value = n, Ps(t), e.state = n, t = e.pending, t !== null && (n = t.next, n === t ? e.pending = null : (n = n.next, t.next = n, As(e, n)));
	}
	function Ns(e, t, n) {
		var r = e.pending;
		if (e.pending = null, r !== null) {
			r = r.next;
			do
				t.status = "rejected", t.reason = n, Ps(t), t = t.next;
			while (t !== r);
		}
		e.action = null;
	}
	function Ps(e) {
		e = e.listeners;
		for (var t = 0; t < e.length; t++) (0, e[t])();
	}
	function Fs(e, t) {
		return t;
	}
	function Is(e, t) {
		if (I) {
			var n = ld.formState;
			if (n !== null) {
				a: {
					var r = L;
					if (I) {
						if (ca) {
							b: {
								for (var i = ca, a = ua; i.nodeType !== 8;) {
									if (!a) {
										i = null;
										break b;
									}
									if (i = wm(i.nextSibling), i === null) {
										i = null;
										break b;
									}
								}
								a = i.data, i = a === "F!" || a === "F" ? i : null;
							}
							if (i) {
								ca = wm(i.nextSibling), r = i.data === "F!";
								break a;
							}
						}
						fa(r);
					}
					r = !1;
				}
				r && (t = n[0]);
			}
		}
		return n = ds(), n.memoizedState = n.baseState = t, r = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: Fs,
			lastRenderedState: t
		}, n.queue = r, n = mc.bind(null, L, r), r.dispatch = n, r = Ds(!1), a = gc.bind(null, L, !1, r.queue), r = ds(), i = {
			state: t,
			dispatch: null,
			action: e,
			pending: null
		}, r.queue = i, n = ks.bind(null, L, i, a, n), i.dispatch = n, r.memoizedState = e, [
			t,
			n,
			!1
		];
	}
	function Ls(e) {
		return Rs(fs(), qo, e);
	}
	function Rs(e, t, n) {
		if (t = ys(e, t, Fs)[0], e = vs(_s)[0], typeof t == "object" && t && typeof t.then == "function") try {
			var r = ms(t);
		} catch (e) {
			throw e === $a ? to : e;
		}
		else r = t;
		t = fs();
		var i = t.queue, a = i.dispatch;
		return n !== t.memoizedState && (L.flags |= 2048, Vs(9, { destroy: void 0 }, zs.bind(null, i, n), null)), [
			r,
			a,
			e
		];
	}
	function zs(e, t) {
		e.action = t;
	}
	function Bs(e) {
		var t = fs(), n = qo;
		if (n !== null) return Rs(t, n, e);
		fs(), t = t.memoizedState, n = fs();
		var r = n.queue.dispatch;
		return n.memoizedState = e, [
			t,
			r,
			!1
		];
	}
	function Vs(e, t, n, r) {
		return e = {
			tag: e,
			create: n,
			deps: r,
			inst: t,
			next: null
		}, t = L.updateQueue, t === null && (t = ps(), L.updateQueue = t), n = t.lastEffect, n === null ? t.lastEffect = e.next = e : (r = n.next, n.next = e, e.next = r, t.lastEffect = e), e;
	}
	function Hs() {
		return fs().memoizedState;
	}
	function Us(e, t, n, r) {
		var i = ds();
		L.flags |= e, i.memoizedState = Vs(1 | t, { destroy: void 0 }, n, r === void 0 ? null : r);
	}
	function Ws(e, t, n, r) {
		var i = fs();
		r = r === void 0 ? null : r;
		var a = i.memoizedState.inst;
		qo !== null && r !== null && rs(r, qo.memoizedState.deps) ? i.memoizedState = Vs(t, a, n, r) : (L.flags |= e, i.memoizedState = Vs(1 | t, a, n, r));
	}
	function Gs(e, t) {
		Us(8390656, 8, e, t);
	}
	function Ks(e, t) {
		Ws(2048, 8, e, t);
	}
	function qs(e) {
		L.flags |= 4;
		var t = L.updateQueue;
		if (t === null) t = ps(), L.updateQueue = t, t.events = [e];
		else {
			var n = t.events;
			n === null ? t.events = [e] : n.push(e);
		}
	}
	function Js(e) {
		var t = fs().memoizedState;
		return qs({
			ref: t,
			nextImpl: e
		}), function() {
			if (cd & 2) throw Error(i(440));
			return t.impl.apply(void 0, arguments);
		};
	}
	function Ys(e, t) {
		return Ws(4, 2, e, t);
	}
	function Xs(e, t) {
		return Ws(4, 4, e, t);
	}
	function Zs(e, t) {
		if (typeof t == "function") {
			e = e();
			var n = t(e);
			return function() {
				typeof n == "function" ? n() : t(null);
			};
		}
		if (t != null) return e = e(), t.current = e, function() {
			t.current = null;
		};
	}
	function Qs(e, t, n) {
		n = n == null ? null : n.concat([e]), Ws(4, 4, Zs.bind(null, t, e), n);
	}
	function $s() {}
	function ec(e, t) {
		var n = fs();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		return t !== null && rs(t, r[1]) ? r[0] : (n.memoizedState = [e, t], e);
	}
	function tc(e, t) {
		var n = fs();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		if (t !== null && rs(t, r[1])) return r[0];
		if (r = e(), Zo) {
			ot(!0);
			try {
				e();
			} finally {
				ot(!1);
			}
		}
		return n.memoizedState = [r, t], r;
	}
	function nc(e, t, n) {
		return n === void 0 || Ko & 1073741824 && !(dd & 261930) ? e.memoizedState = t : (e.memoizedState = n, e = Gd(), L.lanes |= e, yd |= e, n);
	}
	function rc(e, t, n, r) {
		return Jr(n, t) ? n : Ao.current === null ? !(Ko & 106) || Ko & 1073741824 && !(dd & 261930) ? (zc = !0, e.memoizedState = n) : (e = Gd(), L.lanes |= e, yd |= e, t) : (e = nc(e, n, r), Jr(e, t) || (zc = !0), e);
	}
	function ic(e, t, n, r, i) {
		var a = Se.p;
		Se.p = a !== 0 && 8 > a ? a : 8;
		var o = k.T, s = {};
		s.types = o === null ? null : o.types, k.T = s, gc(e, !1, t, n);
		try {
			var c = i(), l = k.S;
			l !== null && l(s, c), typeof c == "object" && c && typeof c.then == "function" ? hc(e, t, qa(c, r), Wd(e)) : hc(e, t, r, Wd(e));
		} catch (n) {
			hc(e, t, {
				then: function() {},
				status: "rejected",
				reason: n
			}, Wd());
		} finally {
			Se.p = a, o !== null && s.types !== null && (o.types = s.types), k.T = o;
		}
	}
	function ac() {}
	function oc(e, t, n, r) {
		if (e.tag !== 5) throw Error(i(476));
		var a = sc(e).queue;
		ic(e, a, t, Ce, n === null ? ac : function() {
			return cc(e), n(r);
		});
	}
	function sc(e) {
		var t = e.memoizedState;
		if (t !== null) return t;
		t = {
			memoizedState: Ce,
			baseState: Ce,
			baseQueue: null,
			queue: {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: _s,
				lastRenderedState: Ce
			},
			next: null
		};
		var n = {};
		return t.next = {
			memoizedState: n,
			baseState: n,
			baseQueue: null,
			queue: {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: _s,
				lastRenderedState: n
			},
			next: null
		}, e.memoizedState = t, e = e.alternate, e !== null && (e.memoizedState = t), t;
	}
	function cc(e) {
		var t = sc(e);
		t.next === null && (t = e.alternate.memoizedState), hc(e, t.next.queue, {}, Wd());
	}
	function lc() {
		return ka(bh);
	}
	function uc() {
		return fs().memoizedState;
	}
	function dc() {
		return fs().memoizedState;
	}
	function fc(e) {
		for (var t = e.return; t !== null;) {
			switch (t.tag) {
				case 24:
				case 3:
					var n = Wd();
					e = xo(n);
					var r = So(t, e, n);
					r !== null && (qd(r, t, n), Co(r, t, n)), t = { cache: Ia() }, e.payload = t;
					return;
			}
			t = t.return;
		}
	}
	function pc(e, t, n) {
		var r = Wd();
		n = {
			lane: r,
			revertLane: 0,
			gesture: null,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, _c(e) ? vc(t, n) : (n = Ni(e, t, n, r), n !== null && (qd(n, e, r), yc(n, t, r)));
	}
	function mc(e, t, n) {
		hc(e, t, n, Wd());
	}
	function hc(e, t, n, r) {
		var i = {
			lane: r,
			revertLane: 0,
			gesture: null,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		};
		if (_c(e)) vc(t, i);
		else {
			var a = e.alternate;
			if (e.lanes === 0 && (a === null || a.lanes === 0) && (a = t.lastRenderedReducer, a !== null)) try {
				var o = t.lastRenderedState, s = a(o, n);
				if (i.hasEagerState = !0, i.eagerState = s, Jr(s, o)) return Mi(e, t, i, 0), ld === null && ji(), !1;
			} catch {}
			if (n = Ni(e, t, i, r), n !== null) return qd(n, e, r), yc(n, t, r), !0;
		}
		return !1;
	}
	function gc(e, t, n, r) {
		if (r = {
			lane: 2,
			revertLane: Jf(),
			gesture: null,
			action: r,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, _c(e)) {
			if (t) throw Error(i(479));
		} else t = Ni(e, n, r, 2), t !== null && qd(t, e, 2);
	}
	function _c(e) {
		var t = e.alternate;
		return e === L || t !== null && t === L;
	}
	function vc(e, t) {
		Xo = Yo = !0;
		var n = e.pending;
		n === null ? t.next = t : (t.next = n.next, n.next = t), e.pending = t;
	}
	function yc(e, t, n) {
		if (n & 4194048) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, wt(e, n);
		}
	}
	var bc = {
		readContext: ka,
		use: hs,
		useCallback: ns,
		useContext: ns,
		useEffect: ns,
		useImperativeHandle: ns,
		useLayoutEffect: ns,
		useInsertionEffect: ns,
		useMemo: ns,
		useReducer: ns,
		useRef: ns,
		useState: ns,
		useDebugValue: ns,
		useDeferredValue: ns,
		useTransition: ns,
		useSyncExternalStore: ns,
		useId: ns,
		useHostTransitionStatus: ns,
		useFormState: ns,
		useActionState: ns,
		useOptimistic: ns,
		useMemoCache: ns,
		useCacheRefresh: ns,
		useEffectEvent: ns
	}, xc = {
		readContext: ka,
		use: hs,
		useCallback: function(e, t) {
			return ds().memoizedState = [e, t === void 0 ? null : t], e;
		},
		useContext: ka,
		useEffect: Gs,
		useImperativeHandle: function(e, t, n) {
			n = n == null ? null : n.concat([e]), Us(4194308, 4, Zs.bind(null, t, e), n);
		},
		useLayoutEffect: function(e, t) {
			return Us(4194308, 4, e, t);
		},
		useInsertionEffect: function(e, t) {
			Us(4, 2, e, t);
		},
		useMemo: function(e, t) {
			var n = ds();
			t = t === void 0 ? null : t;
			var r = e();
			if (Zo) {
				ot(!0);
				try {
					e();
				} finally {
					ot(!1);
				}
			}
			return n.memoizedState = [r, t], r;
		},
		useReducer: function(e, t, n) {
			var r = ds();
			if (n !== void 0) {
				var i = n(t);
				if (Zo) {
					ot(!0);
					try {
						n(t);
					} finally {
						ot(!1);
					}
				}
			} else i = t;
			return r.memoizedState = r.baseState = i, e = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: e,
				lastRenderedState: i
			}, r.queue = e, e = e.dispatch = pc.bind(null, L, e), [r.memoizedState, e];
		},
		useRef: function(e) {
			var t = ds();
			return e = { current: e }, t.memoizedState = e;
		},
		useState: function(e) {
			e = Ds(e);
			var t = e.queue, n = mc.bind(null, L, t);
			return t.dispatch = n, [e.memoizedState, n];
		},
		useDebugValue: $s,
		useDeferredValue: function(e, t) {
			return nc(ds(), e, t);
		},
		useTransition: function() {
			var e = Ds(!1);
			return e = ic.bind(null, L, e.queue, !0, !1), ds().memoizedState = e, [!1, e];
		},
		useSyncExternalStore: function(e, t, n) {
			var r = L, a = ds();
			if (I) {
				if (n === void 0) throw Error(i(407));
				n = n();
			} else {
				if (n = t(), ld === null) throw Error(i(349));
				dd & 127 || Ss(r, t, n);
			}
			a.memoizedState = n;
			var o = {
				value: n,
				getSnapshot: t
			};
			return a.queue = o, Gs(ws.bind(null, r, o, e), [e]), r.flags |= 2048, Vs(9, { destroy: void 0 }, Cs.bind(null, r, o, n, t), null), n;
		},
		useId: function() {
			var e = ds(), t = ld.identifierPrefix;
			if (I) {
				var n = ra, r = na;
				n = (r & ~(1 << 32 - st(r) - 1)).toString(32) + n, t = "_" + t + "R_" + n, n = Qo++, 0 < n && (t += "H" + n.toString(32)), t += "_";
			} else n = ts++, t = "_" + t + "r_" + n.toString(32) + "_";
			return e.memoizedState = t;
		},
		useHostTransitionStatus: lc,
		useFormState: Is,
		useActionState: Is,
		useOptimistic: function(e) {
			var t = ds();
			t.memoizedState = t.baseState = e;
			var n = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: null,
				lastRenderedState: null
			};
			return t.queue = n, t = gc.bind(null, L, !0, n), n.dispatch = t, [e, t];
		},
		useMemoCache: gs,
		useCacheRefresh: function() {
			return ds().memoizedState = fc.bind(null, L);
		},
		useEffectEvent: function(e) {
			var t = ds(), n = { impl: e };
			return t.memoizedState = n, function() {
				if (cd & 2) throw Error(i(440));
				return n.impl.apply(void 0, arguments);
			};
		}
	}, Sc = {
		readContext: ka,
		use: hs,
		useCallback: ec,
		useContext: ka,
		useEffect: Ks,
		useImperativeHandle: Qs,
		useInsertionEffect: Ys,
		useLayoutEffect: Xs,
		useMemo: tc,
		useReducer: vs,
		useRef: Hs,
		useState: function() {
			return vs(_s);
		},
		useDebugValue: $s,
		useDeferredValue: function(e, t) {
			return rc(fs(), qo.memoizedState, e, t);
		},
		useTransition: function() {
			var e = vs(_s)[0], t = fs().memoizedState;
			return [typeof e == "boolean" ? e : ms(e), t];
		},
		useSyncExternalStore: xs,
		useId: uc,
		useHostTransitionStatus: lc,
		useFormState: Ls,
		useActionState: Ls,
		useOptimistic: function(e, t) {
			return Os(fs(), qo, e, t);
		},
		useMemoCache: gs,
		useCacheRefresh: dc,
		useEffectEvent: Js
	}, Cc = {
		readContext: ka,
		use: hs,
		useCallback: ec,
		useContext: ka,
		useEffect: Ks,
		useImperativeHandle: Qs,
		useInsertionEffect: Ys,
		useLayoutEffect: Xs,
		useMemo: tc,
		useReducer: bs,
		useRef: Hs,
		useState: function() {
			return bs(_s);
		},
		useDebugValue: $s,
		useDeferredValue: function(e, t) {
			var n = fs();
			return qo === null ? nc(n, e, t) : rc(n, qo.memoizedState, e, t);
		},
		useTransition: function() {
			var e = bs(_s)[0], t = fs().memoizedState;
			return [typeof e == "boolean" ? e : ms(e), t];
		},
		useSyncExternalStore: xs,
		useId: uc,
		useHostTransitionStatus: lc,
		useFormState: Bs,
		useActionState: Bs,
		useOptimistic: function(e, t) {
			var n = fs();
			return qo === null ? (n.baseState = e, [e, n.queue.dispatch]) : Os(n, qo, e, t);
		},
		useMemoCache: gs,
		useCacheRefresh: dc,
		useEffectEvent: Js
	};
	function wc(e, t, n, r) {
		t = e.memoizedState, n = n(r, t), n = n == null ? t : E({}, t, n), e.memoizedState = n, e.lanes === 0 && (e.updateQueue.baseState = n);
	}
	var Tc = {
		enqueueSetState: function(e, t, n) {
			e = e._reactInternals;
			var r = Wd(), i = xo(r);
			i.payload = t, n != null && (i.callback = n), t = So(e, i, r), t !== null && (qd(t, e, r), Co(t, e, r));
		},
		enqueueReplaceState: function(e, t, n) {
			e = e._reactInternals;
			var r = Wd(), i = xo(r);
			i.tag = 1, i.payload = t, n != null && (i.callback = n), t = So(e, i, r), t !== null && (qd(t, e, r), Co(t, e, r));
		},
		enqueueForceUpdate: function(e, t) {
			e = e._reactInternals;
			var n = Wd(), r = xo(n);
			r.tag = 2, t != null && (r.callback = t), t = So(e, r, n), t !== null && (qd(t, e, n), Co(t, e, n));
		}
	};
	function Ec(e, t, n, r, i, a, o) {
		return e = e.stateNode, typeof e.shouldComponentUpdate == "function" ? e.shouldComponentUpdate(r, a, o) : t.prototype && t.prototype.isPureReactComponent ? !Yr(n, r) || !Yr(i, a) : !0;
	}
	function Dc(e, t, n, r) {
		e = t.state, typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(n, r), typeof t.UNSAFE_componentWillReceiveProps == "function" && t.UNSAFE_componentWillReceiveProps(n, r), t.state !== e && Tc.enqueueReplaceState(t, t.state, null);
	}
	function Oc(e, t) {
		var n = t;
		if ("ref" in t) for (var r in n = {}, t) r !== "ref" && (n[r] = t[r]);
		if (e = e.defaultProps) for (var i in n === t && (n = E({}, n)), e) n[i] === void 0 && (n[i] = e[i]);
		return n;
	}
	function kc(e) {
		Di(e);
	}
	function Ac(e) {
		console.error(e);
	}
	function jc(e) {
		Di(e);
	}
	function Mc(e, t) {
		try {
			var n = e.onUncaughtError;
			n(t.value, { componentStack: t.stack });
		} catch (e) {
			setTimeout(function() {
				throw e;
			});
		}
	}
	function Nc(e, t, n) {
		try {
			var r = e.onCaughtError;
			r(n.value, {
				componentStack: n.stack,
				errorBoundary: t.tag === 1 ? t.stateNode : null
			});
		} catch (e) {
			setTimeout(function() {
				throw e;
			});
		}
	}
	function Pc(e, t, n) {
		return n = xo(n), n.tag = 3, n.payload = { element: null }, n.callback = function() {
			Mc(e, t);
		}, n;
	}
	function Fc(e) {
		return e = xo(e), e.tag = 3, e;
	}
	function Ic(e, t, n, r) {
		var i = n.type.getDerivedStateFromError;
		if (typeof i == "function") {
			var a = r.value;
			e.payload = function() {
				return i(a);
			}, e.callback = function() {
				Nc(t, n, r);
			};
		}
		var o = n.stateNode;
		o !== null && typeof o.componentDidCatch == "function" && (e.callback = function() {
			Nc(t, n, r), typeof i != "function" && (jd === null ? jd = /* @__PURE__ */ new Set([this]) : jd.add(this));
			var e = r.stack;
			this.componentDidCatch(r.value, { componentStack: e === null ? "" : e });
		});
	}
	function Lc(e, t, n, r, a) {
		if (n.flags |= 32768, typeof r == "object" && r && typeof r.then == "function") {
			if (t = n.alternate, t !== null && Ea(t, n, a, !0), n = Fo.current, n !== null) {
				switch (n.tag) {
					case 31:
					case 13:
					case 19: return Io === null ? of() : n.alternate === null && vd === 0 && (vd = 3), n.flags &= -257, n.flags |= 65536, n.lanes = a, r === no ? n.flags |= 16384 : (t = n.updateQueue, t === null ? n.updateQueue = /* @__PURE__ */ new Set([r]) : t.add(r), Of(e, r, a)), !1;
					case 22: return n.flags |= 65536, r === no ? n.flags |= 16384 : (t = n.updateQueue, t === null ? (t = {
						transitions: null,
						markerInstances: null,
						retryQueue: /* @__PURE__ */ new Set([r])
					}, n.updateQueue = t) : (n = t.retryQueue, n === null ? t.retryQueue = /* @__PURE__ */ new Set([r]) : n.add(r)), Of(e, r, a)), !1;
				}
				throw Error(i(435, n.tag));
			}
			return Of(e, r, a), of(), !1;
		}
		if (I) return t = Fo.current, t === null ? (r !== da && (t = Error(i(423), { cause: r }), va(N(t, n))), e = e.current.alternate, e.flags |= 65536, a &= -a, e.lanes |= a, r = N(r, n), a = Pc(e.stateNode, r, a), wo(e, a), vd !== 4 && (vd = 2)) : (!(t.flags & 65536) && (t.flags |= 256), t.flags |= 65536, t.lanes = a, r !== da && (e = Error(i(422), { cause: r }), va(N(e, n)))), !1;
		var o = Error(i(520), { cause: r });
		if (o = N(o, n), wd === null ? wd = [o] : wd.push(o), vd !== 4 && (vd = 2), t === null) return !0;
		r = N(r, n), n = t;
		do {
			switch (n.tag) {
				case 3: return n.flags |= 65536, e = a & -a, n.lanes |= e, e = Pc(n.stateNode, r, e), wo(n, e), !1;
				case 1:
					if (t = n.type, o = n.stateNode, !(n.flags & 128) && (typeof t.getDerivedStateFromError == "function" || o !== null && typeof o.componentDidCatch == "function" && (jd === null || !jd.has(o)))) return n.flags |= 65536, a &= -a, n.lanes |= a, a = Fc(a), Ic(a, e, n, r), wo(n, a), !1;
					break;
				case 22: if (n.memoizedState !== null) return n.flags |= 65536, !1;
			}
			n = n.return;
		} while (n !== null);
		return !1;
	}
	var Rc = Error(i(461)), zc = !1;
	function Bc(e, t, n, r) {
		t.child = e === null ? _o(t, null, n, r) : go(t, e.child, n, r);
	}
	function Vc(e, t, n, r, i) {
		n = n.render;
		var a = t.ref;
		if ("ref" in r) {
			var o = {};
			for (var s in r) s !== "ref" && (o[s] = r[s]);
		} else o = r;
		return Oa(t), r = is(e, t, n, o, a, i), s = cs(), e !== null && !zc ? (ls(e, t, i), hl(e, t, i)) : (I && s && F(t), t.flags |= 1, Bc(e, t, r, i), t.child);
	}
	function Hc(e, t, n, r, i) {
		if (e === null) {
			var a = n.type;
			return typeof a == "function" && !Bi(a) && a.defaultProps === void 0 && n.compare === null ? (t.tag = 15, t.type = a, Uc(e, t, a, r, i)) : (e = Ui(n.type, null, r, t, t.mode, i), e.ref = t.ref, e.return = t, t.child = e);
		}
		if (a = e.child, !gl(e, i)) {
			var o = a.memoizedProps;
			if (n = n.compare, n = n === null ? Yr : n, n(o, r) && e.ref === t.ref) return hl(e, t, i);
		}
		return t.flags |= 1, e = Vi(a, r), e.ref = t.ref, e.return = t, t.child = e;
	}
	function Uc(e, t, n, r, i) {
		if (e !== null) {
			var a = e.memoizedProps;
			if (Yr(a, r) && e.ref === t.ref) {
				if (zc = !1, t.pendingProps = r = a, gl(e, i)) e.flags & 131072 && (zc = !0);
				else return t.lanes = e.lanes, hl(e, t, i);
			}
		}
		return Zc(e, t, n, r, i);
	}
	function Wc(e, t, n, r) {
		var i = r.children, a = e === null ? null : e.memoizedState;
		if (e === null && t.stateNode === null && (t.stateNode = {
			_visibility: 1,
			_pendingMarkers: null,
			_retryCache: null,
			_transitions: null
		}), r.mode === "hidden") {
			if (t.flags & 128) {
				if (a = a === null ? n : a.baseLanes | n, e !== null) {
					for (r = t.child = e.child, i = 0; r !== null;) i = i | r.lanes | r.childLanes, r = r.sibling;
					r = i & ~a;
				} else r = 0, t.child = null;
				return Kc(e, t, a, n, r);
			}
			if (n & 536870912) t.memoizedState = {
				baseLanes: 0,
				cachePool: null
			}, e !== null && Za(t, a === null ? null : a.cachePool), a === null ? No() : Mo(t, a), zo(t);
			else return r = t.lanes = 536870912, Kc(e, t, a === null ? n : a.baseLanes | n, n, r);
		} else a === null ? (e !== null && Za(t, null), No(), Bo()) : (Za(t, a.cachePool), Mo(t, a), Bo(), t.memoizedState = null);
		return Bc(e, t, i, n), t.child;
	}
	function Gc(e, t) {
		return e !== null && e.tag === 22 || t.stateNode !== null || (t.stateNode = {
			_visibility: 1,
			_pendingMarkers: null,
			_retryCache: null,
			_transitions: null
		}), t.sibling;
	}
	function Kc(e, t, n, r, i) {
		var a = Xa();
		return a = a === null ? null : {
			parent: Fa._currentValue,
			pool: a
		}, t.memoizedState = {
			baseLanes: n,
			cachePool: a
		}, e !== null && Za(t, null), No(), zo(t), e !== null && Ea(e, t, r, !0), t.childLanes = i, null;
	}
	function qc(e, t) {
		return t = ol({
			mode: t.mode,
			children: t.children
		}, e.mode), t.ref = e.ref, e.child = t, t.return = e, t;
	}
	function Jc(e, t, n) {
		return go(t, e.child, null, n), e = qc(t, t.pendingProps), e.flags |= 2, Vo(t), t.memoizedState = null, e;
	}
	function Yc(e, t, n) {
		var r = t.pendingProps, a = !!(t.flags & 128);
		if (t.flags &= -129, e === null) {
			if (I) {
				if (r.mode === "hidden") return e = qc(t, r), t.lanes = 536870912, e.memoizedState = {
					baseLanes: 0,
					cachePool: null
				}, Gc(null, e);
				if (Ro(t), (e = ca) ? (e = bm(e, ua), e = e !== null && e.data === "&" ? e : null, e !== null && (t.memoizedState = {
					dehydrated: e,
					treeContext: ta === null ? null : {
						id: na,
						overflow: ra
					},
					retryLane: 536870912,
					hydrationErrors: null
				}, n = Ki(e), n.return = t, t.child = n, sa = t, ca = null)) : e = null, e === null) throw fa(t);
				return t.lanes = 536870912, null;
			}
			return qc(t, r);
		}
		var o = e.memoizedState;
		if (o !== null) {
			var s = o.dehydrated;
			if (Ro(t), a) {
				if (t.flags & 256) t.flags &= -257, t = Jc(e, t, n);
				else if (t.memoizedState !== null) t.child = e.child, t.flags |= 128, t = null;
				else throw Error(i(558));
			} else if (zc || Ea(e, t, n, !1), a = (n & e.childLanes) !== 0, zc || a) {
				if (Ao.current === null) {
					if (r = ld, r !== null && (s = Tt(r, n), s !== 0 && s !== o.retryLane)) throw o.retryLane = s, Pi(e, s), qd(r, e, s), Rc;
					of();
				}
				t = Jc(e, t, n);
			} else e = o.treeContext, ca = wm(s.nextSibling), sa = t, I = !0, la = null, ua = !1, e !== null && oa(t, e), t = qc(t, r), t.flags |= 134221824;
			return t;
		}
		return e = Vi(e.child, {
			mode: r.mode,
			children: r.children
		}), e.ref = t.ref, t.child = e, e.return = t, e;
	}
	function Xc(e, t) {
		var n = t.ref;
		if (n === null) e !== null && e.ref !== null && (t.flags |= 4194816);
		else {
			if (typeof n != "function" && typeof n != "object") throw Error(i(284));
			(e === null || e.ref !== n) && (t.flags |= 4194816);
		}
	}
	function Zc(e, t, n, r, i) {
		return Oa(t), n = is(e, t, n, r, void 0, i), r = cs(), e !== null && !zc ? (ls(e, t, i), hl(e, t, i)) : (I && r && F(t), t.flags |= 1, Bc(e, t, n, i), t.child);
	}
	function Qc(e, t, n, r, i, a) {
		return Oa(t), t.updateQueue = null, n = os(t, r, n, i), as(e), r = cs(), e !== null && !zc ? (ls(e, t, a), hl(e, t, a)) : (I && r && F(t), t.flags |= 1, Bc(e, t, n, a), t.child);
	}
	function $c(e, t, n, r, i) {
		if (Oa(t), t.stateNode === null) {
			var a = Li, o = n.contextType;
			typeof o == "object" && o && (a = ka(o)), a = new n(r, a), t.memoizedState = a.state !== null && a.state !== void 0 ? a.state : null, a.updater = Tc, t.stateNode = a, a._reactInternals = t, a = t.stateNode, a.props = r, a.state = t.memoizedState, a.refs = {}, yo(t), o = n.contextType, a.context = typeof o == "object" && o ? ka(o) : Li, a.state = t.memoizedState, o = n.getDerivedStateFromProps, typeof o == "function" && (wc(t, n, o, r), a.state = t.memoizedState), typeof n.getDerivedStateFromProps == "function" || typeof a.getSnapshotBeforeUpdate == "function" || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (o = a.state, typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount(), o !== a.state && Tc.enqueueReplaceState(a, a.state, null), Do(t, r, a, i), Eo(), a.state = t.memoizedState), typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !0;
		} else if (e === null) {
			a = t.stateNode;
			var s = t.memoizedProps, c = Oc(n, s);
			a.props = c;
			var l = a.context, u = n.contextType;
			o = Li, typeof u == "object" && u && (o = ka(u));
			var d = n.getDerivedStateFromProps;
			u = typeof d == "function" || typeof a.getSnapshotBeforeUpdate == "function", s = t.pendingProps !== s, u || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (s || l !== o) && Dc(t, a, r, o), vo = !1;
			var f = t.memoizedState;
			a.state = f, Do(t, r, a, i), Eo(), l = t.memoizedState, s || f !== l || vo ? (typeof d == "function" && (wc(t, n, d, r), l = t.memoizedState), (c = vo || Ec(t, n, c, r, f, l, o)) ? (u || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount()), typeof a.componentDidMount == "function" && (t.flags |= 4194308)) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), t.memoizedProps = r, t.memoizedState = l), a.props = r, a.state = l, a.context = o, r = c) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !1);
		} else {
			a = t.stateNode, bo(e, t), o = t.memoizedProps, u = Oc(n, o), a.props = u, d = t.pendingProps, f = a.context, l = n.contextType, c = Li, typeof l == "object" && l && (c = ka(l)), s = n.getDerivedStateFromProps, (l = typeof s == "function" || typeof a.getSnapshotBeforeUpdate == "function") || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (o !== d || f !== c) && Dc(t, a, r, c), vo = !1, f = t.memoizedState, a.state = f, Do(t, r, a, i), Eo();
			var p = t.memoizedState;
			o !== d || f !== p || vo || e !== null && e.dependencies !== null && Da(e.dependencies) ? (typeof s == "function" && (wc(t, n, s, r), p = t.memoizedState), (u = vo || Ec(t, n, u, r, f, p, c) || e !== null && e.dependencies !== null && Da(e.dependencies)) ? (l || typeof a.UNSAFE_componentWillUpdate != "function" && typeof a.componentWillUpdate != "function" || (typeof a.componentWillUpdate == "function" && a.componentWillUpdate(r, p, c), typeof a.UNSAFE_componentWillUpdate == "function" && a.UNSAFE_componentWillUpdate(r, p, c)), typeof a.componentDidUpdate == "function" && (t.flags |= 4), typeof a.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024)) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), t.memoizedProps = r, t.memoizedState = p), a.props = r, a.state = p, a.context = c, r = u) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), r = !1);
		}
		return a = r, Xc(e, t), r = !!(t.flags & 128), a || r ? (a = t.stateNode, n = r && typeof n.getDerivedStateFromError != "function" ? null : a.render(), t.flags |= 1, e !== null && r ? (t.child = go(t, e.child, null, i), t.child = go(t, null, n, i)) : Bc(e, t, n, i), t.memoizedState = a.state, e = t.child) : e = hl(e, t, i), e;
	}
	function el(e, t, n, r) {
		return ga(), t.flags |= 256, Bc(e, t, n, r), t.child;
	}
	var tl = {
		dehydrated: null,
		treeContext: null,
		retryLane: 0,
		hydrationErrors: null
	};
	function nl(e) {
		return {
			baseLanes: e,
			cachePool: Qa()
		};
	}
	function rl(e, t, n) {
		return e = e === null ? 0 : e.childLanes & ~n, t && (e |= Sd), e;
	}
	function il(e, t, n) {
		var r = t.pendingProps, i = !1, a = !!(t.flags & 128), o;
		if ((o = a) || (o = e !== null && e.memoizedState === null ? !1 : !!(Ho.current & 2)), o && (i = !0, t.flags &= -129), o = !!(t.flags & 32), t.flags &= -33, e === null) {
			if (I) {
				if (i ? Lo(t) : Bo(), (e = ca) ? (e = bm(e, ua), e = e !== null && e.data !== "&" ? e : null, e !== null && (t.memoizedState = {
					dehydrated: e,
					treeContext: ta === null ? null : {
						id: na,
						overflow: ra
					},
					retryLane: 536870912,
					hydrationErrors: null
				}, n = Ki(e), n.return = t, t.child = n, sa = t, ca = null)) : e = null, e === null) throw fa(t);
				return t.lanes = Sm(e) ? 32 : 536870912, null;
			}
			return a = r.children, r = r.fallback, i ? (Bo(), i = t.mode, a = ol({
				mode: "hidden",
				children: a
			}, i), r = Wi(r, i, n, null), a.return = t, r.return = t, a.sibling = r, t.child = a, r = t.child, r.memoizedState = nl(n), r.childLanes = rl(e, o, n), t.memoizedState = tl, Gc(null, r)) : (Lo(t), al(t, a));
		}
		var s = e.memoizedState;
		if (s !== null) {
			var c = s.dehydrated;
			if (c !== null) return cl(e, t, a, o, r, c, s, n);
		}
		return i ? (Bo(), i = r.fallback, a = t.mode, s = e.child, c = s.sibling, r = Vi(s, {
			mode: "hidden",
			children: r.children
		}), r.subtreeFlags = s.subtreeFlags & 1206910976, c === null ? (i = Wi(i, a, n, null), i.flags |= 2) : i = Vi(c, i), i.return = t, r.return = t, r.sibling = i, t.child = r, Gc(null, r), r = t.child, i = e.child.memoizedState, i === null ? i = nl(n) : (a = i.cachePool, a === null ? a = Qa() : (s = Fa._currentValue, a = a.parent === s ? a : {
			parent: s,
			pool: s
		}), i = {
			baseLanes: i.baseLanes | n,
			cachePool: a
		}), r.memoizedState = i, r.childLanes = rl(e, o, n), t.memoizedState = tl, Gc(e.child, r)) : (Lo(t), n = e.child, e = n.sibling, n = Vi(n, {
			mode: "visible",
			children: r.children
		}), n.return = t, n.sibling = null, e !== null && (o = t.deletions, o === null ? (t.deletions = [e], t.flags |= 16) : o.push(e)), t.child = n, t.memoizedState = null, n);
	}
	function al(e, t) {
		return t = ol({
			mode: "visible",
			children: t
		}, e.mode), t.return = e, e.child = t;
	}
	function ol(e, t) {
		return e = zi(22, e, null, t), e.lanes = 0, e;
	}
	function sl(e, t, n) {
		return go(t, e.child, null, n), e = al(t, t.pendingProps.children), e.flags |= 2, t.memoizedState = null, e;
	}
	function cl(e, t, n, r, a, o, s, c) {
		if (n) return t.flags & 256 ? (Lo(t), t.flags &= -257, sl(e, t, c)) : t.memoizedState === null ? (Bo(), o = a.fallback, s = t.mode, a = ol({
			mode: "visible",
			children: a.children
		}, s), o = Wi(o, s, c, null), o.flags |= 2, a.return = t, o.return = t, a.sibling = o, t.child = a, go(t, e.child, null, c), a = t.child, a.memoizedState = nl(c), a.childLanes = rl(e, r, c), t.memoizedState = tl, Gc(null, a)) : (Bo(), t.child = e.child, t.flags |= 128, null);
		if (Lo(t), Sm(o)) {
			if (r = o.nextSibling && o.nextSibling.dataset, r) var l = r.dgst;
			return r = l, r !== "" && (a = Error(i(419)), a.stack = "", a.digest = r, va({
				value: a,
				source: null,
				stack: null
			})), sl(e, t, c);
		}
		if (zc || Ea(e, t, c, !1), r = (c & e.childLanes) !== 0, zc || r) {
			if (Ao.current !== null) return sl(e, t, c);
			if (r = ld, r !== null && (a = Tt(r, c), a !== 0 && a !== s.retryLane)) throw s.retryLane = a, Pi(e, a), qd(r, e, a), Rc;
			return xm(o) || of(), sl(e, t, c);
		}
		return xm(o) ? (t.flags |= 192, t.child = e.child, null) : (e = s.treeContext, ca = wm(o.nextSibling), sa = t, I = !0, la = null, ua = !1, e !== null && oa(t, e), t = al(t, a.children), t.flags |= 134221824, t);
	}
	function ll(e, t, n) {
		e.lanes |= t;
		var r = e.alternate;
		r !== null && (r.lanes |= t), wa(e.return, t, n);
	}
	function ul(e) {
		for (var t = null; e !== null;) {
			var n = e.alternate;
			n !== null && Go(n) === null && (t = e), e = e.sibling;
		}
		return t;
	}
	function dl(e, t, n, r, i, a) {
		var o = e.memoizedState;
		o === null ? e.memoizedState = {
			isBackwards: t,
			rendering: null,
			renderingStartTime: 0,
			last: r,
			tail: n,
			tailMode: i,
			treeForkCount: a
		} : (o.isBackwards = t, o.rendering = null, o.renderingStartTime = 0, o.last = r, o.tail = n, o.tailMode = i, o.treeForkCount = a);
	}
	function fl(e) {
		var t = e.child;
		for (e.child = null; t !== null;) {
			var n = t.sibling;
			t.sibling = e.child, e.child = t, t = n;
		}
	}
	function pl(e, t, n) {
		var r = t.pendingProps, i = r.revealOrder, a = r.tail;
		r = r.children;
		var o = Ho.current;
		if (t.flags & 128) return Uo(t, o), null;
		var s = !!(o & 2);
		if (s ? (o = o & 1 | 2, t.flags |= 128) : o &= 1, Uo(t, o), i === "backwards" && e !== null ? (fl(e), Bc(e, t, r, n), fl(e)) : Bc(e, t, r, n), r = I ? Qi : 0, !s && e !== null && e.flags & 128) a: for (e = t.child; e !== null;) {
			if (e.tag === 13) e.memoizedState !== null && ll(e, n, t);
			else if (e.tag === 19) ll(e, n, t);
			else if (e.child !== null) {
				e.child.return = e, e = e.child;
				continue;
			}
			if (e === t) break a;
			for (; e.sibling === null;) {
				if (e.return === null || e.return === t) break a;
				e = e.return;
			}
			e.sibling.return = e.return, e = e.sibling;
		}
		switch (i) {
			case "backwards":
				n = ul(t.child), n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null, fl(t)), dl(t, !0, i, null, a, r);
				break;
			case "unstable_legacy-backwards":
				for (n = null, i = t.child, t.child = null; i !== null;) {
					if (e = i.alternate, e !== null && Go(e) === null) {
						t.child = i;
						break;
					}
					e = i.sibling, i.sibling = n, n = i, i = e;
				}
				dl(t, !0, n, null, a, r);
				break;
			case "together":
				dl(t, !1, null, null, void 0, r);
				break;
			case "independent":
				t.memoizedState = null;
				break;
			default: n = ul(t.child), n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null), dl(t, !1, i, n, a, r);
		}
		return t.child;
	}
	function ml(e, t, n) {
		var r = t.pendingProps;
		return Sa(t, t.type, r.value), Bc(e, t, r.children, n), t.child;
	}
	function hl(e, t, n) {
		if (e !== null && (t.dependencies = e.dependencies), yd |= t.lanes, (n & t.childLanes) === 0) {
			if (e !== null) {
				if (Ea(e, t, n, !1), (n & t.childLanes) === 0) return null;
			} else return null;
		}
		if (e !== null && t.child !== e.child) throw Error(i(153));
		if (t.child !== null) {
			for (e = t.child, n = Vi(e, e.pendingProps), t.child = n, n.return = t; e.sibling !== null;) e = e.sibling, n = n.sibling = Vi(e, e.pendingProps), n.return = t;
			n.sibling = null;
		}
		return t.child;
	}
	function gl(e, t) {
		return (e.lanes & t) !== 0 || (e = e.dependencies, !!(e !== null && Da(e)));
	}
	function _l(e, t, n) {
		switch (t.tag) {
			case 3:
				Ne(t, t.stateNode.containerInfo), Sa(t, Fa, e.memoizedState.cache), ga();
				break;
			case 27:
			case 5:
				Fe(t);
				break;
			case 4:
				Ne(t, t.stateNode.containerInfo);
				break;
			case 10:
				Sa(t, t.type, t.memoizedProps.value);
				break;
			case 31:
				if (t.memoizedState !== null) return t.flags |= 128, Ro(t), null;
				break;
			case 13:
				var r = t.memoizedState;
				if (r !== null) {
					if (r.dehydrated !== null) return Lo(t), t.flags |= 128, null;
					r = Ea(e, t, n, !1);
					var i = t.child.childLanes;
					return r || (n & i) !== 0 ? il(e, t, n) : (Lo(t), e = hl(e, t, n), e === null ? null : e.sibling);
				}
				Lo(t);
				break;
			case 19:
				if (t.flags & 128) return pl(e, t, n);
				if (i = !!(e.flags & 128), r = (n & t.childLanes) !== 0, r ||= (Ea(e, t, n, !1), (n & t.childLanes) !== 0), i) {
					if (r) return pl(e, t, n);
					t.flags |= 128;
				}
				if (i = t.memoizedState, i !== null && (i.rendering = null, i.tail = null, i.lastEffect = null), Uo(t, Ho.current), r) break;
				return null;
			case 22: return t.lanes = 0, Wc(e, t, n, t.pendingProps);
			case 24: Sa(t, Fa, e.memoizedState.cache);
		}
		return hl(e, t, n);
	}
	function vl(e, t, n) {
		if (e !== null) {
			if (e.memoizedProps !== t.pendingProps) zc = !0;
			else {
				if (!gl(e, n) && !(t.flags & 128)) return zc = !1, _l(e, t, n);
				zc = !!(e.flags & 131072);
			}
		} else zc = !1, I && t.flags & 1048576 && ia(t, Qi, t.index);
		switch (t.lanes = 0, t.tag) {
			case 16:
				a: {
					var r = t.pendingProps;
					if (e = ao(t.elementType), t.type = e, typeof e == "function") Bi(e) ? (r = Oc(e, r), t.tag = 1, t = $c(null, t, e, r, n)) : (t.tag = 0, t = Zc(null, t, e, r, n));
					else {
						if (e != null) {
							var a = e.$$typeof;
							if (a === se) {
								t.tag = 11, t = Vc(null, t, e, r, n);
								break a;
							}
							if (a === ue) {
								t.tag = 14, t = Hc(null, t, e, r, n);
								break a;
							}
							if (a === oe) {
								t.tag = 10, t.type = e, t = ml(null, t, n);
								break a;
							}
						}
						throw t = be(e) || e, Error(i(306, t, ""));
					}
				}
				return t;
			case 0: return Zc(e, t, t.type, t.pendingProps, n);
			case 1: return r = t.type, a = Oc(r, t.pendingProps), $c(e, t, r, a, n);
			case 3:
				a: {
					if (Ne(t, t.stateNode.containerInfo), e === null) throw Error(i(387));
					r = t.pendingProps;
					var o = t.memoizedState;
					a = o.element, bo(e, t), Do(t, r, null, n);
					var s = t.memoizedState;
					if (r = s.cache, Sa(t, Fa, r), r !== o.cache && Ta(t, [Fa], n, !0), Eo(), r = s.element, o.isDehydrated) {
						if (o = {
							element: r,
							isDehydrated: !1,
							cache: s.cache
						}, t.updateQueue.baseState = o, t.memoizedState = o, t.flags & 256) {
							t = el(e, t, r, n);
							break a;
						}
						if (r !== a) {
							a = N(Error(i(424)), t), va(a), t = el(e, t, r, n);
							break a;
						}
						switch (e = t.stateNode.containerInfo, e.nodeType) {
							case 9:
								e = e.body;
								break;
							default: e = e.nodeName === "HTML" ? e.ownerDocument.body : e;
						}
						for (ca = wm(e.firstChild), sa = t, I = !0, la = null, ua = !0, n = _o(t, null, r, n), t.child = n; n;) n.flags = n.flags & -3 | 134221824, n = n.sibling;
					} else {
						if (ga(), r === a) {
							t = hl(e, t, n);
							break a;
						}
						Bc(e, t, r, n);
					}
					t = t.child;
				}
				return t;
			case 26: return Xc(e, t), e === null ? (n = qm(t.type, null, t.pendingProps, null)) ? t.memoizedState = n : I || (t.stateNode = Dp(t.type, t.pendingProps, je.current, t)) : t.memoizedState = qm(t.type, e.memoizedProps, t.pendingProps, e.memoizedState), null;
			case 27: return Fe(t), e === null && I && (r = t.stateNode = Am(t.type, t.pendingProps, je.current), sa = t, ua = !0, a = ca, Lp(t.type) ? (Tm = a, ca = wm(r.firstChild)) : ca = a), Bc(e, t, t.pendingProps.children, n), Xc(e, t), e === null && (t.flags |= 4194304), t.child;
			case 5: return e === null && I && ((a = r = ca) && (r = vm(r, t.type, t.pendingProps, ua), r === null ? a = !1 : (t.stateNode = r, sa = t, ca = wm(r.firstChild), ua = !1, a = !0)), a || fa(t)), Fe(t), a = t.type, o = t.pendingProps, s = e === null ? null : e.memoizedProps, r = o.children, Op(a, o) ? r = null : s !== null && Op(a, s) && (t.flags |= 32), t.memoizedState !== null && (a = is(e, t, ss, null, null, n), bh._currentValue = a), Xc(e, t), Bc(e, t, r, n), t.child;
			case 6: return e === null && I && ((e = n = ca) && (n = ym(n, t.pendingProps, ua), n === null ? e = !1 : (t.stateNode = n, sa = t, ca = null, e = !0)), e || fa(t)), null;
			case 13: return il(e, t, n);
			case 4: return Ne(t, t.stateNode.containerInfo), r = t.pendingProps, e === null ? t.child = go(t, null, r, n) : Bc(e, t, r, n), t.child;
			case 11: return Vc(e, t, t.type, t.pendingProps, n);
			case 7: return r = t.pendingProps, Xc(e, t), Bc(e, t, r, n), t.child;
			case 8: return Bc(e, t, t.pendingProps.children, n), t.child;
			case 12: return Bc(e, t, t.pendingProps.children, n), t.child;
			case 10: return ml(e, t, n);
			case 9: return a = t.type._context, r = t.pendingProps.children, Oa(t), a = ka(a), r = r(a), t.flags |= 1, Bc(e, t, r, n), t.child;
			case 14: return Hc(e, t, t.type, t.pendingProps, n);
			case 15: return Uc(e, t, t.type, t.pendingProps, n);
			case 19: return pl(e, t, n);
			case 31: return Yc(e, t, n);
			case 22: return Wc(e, t, n, t.pendingProps);
			case 24: return Oa(t), r = ka(Fa), e === null ? (a = Xa(), a === null && (a = ld, o = Ia(), a.pooledCache = o, o.refCount++, o !== null && (a.pooledCacheLanes |= n), a = o), t.memoizedState = {
				parent: r,
				cache: a
			}, yo(t), Sa(t, Fa, a)) : ((e.lanes & n) !== 0 && (bo(e, t), Do(t, null, null, n), Eo()), a = e.memoizedState, o = t.memoizedState, a.parent === r ? (r = o.cache, Sa(t, Fa, r), r !== a.cache && Ta(t, [Fa], n, !0)) : (a = {
				parent: r,
				cache: r
			}, t.memoizedState = a, t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = a), Sa(t, Fa, r))), Bc(e, t, t.pendingProps.children, n), t.child;
			case 30: return t.stateNode === null && (t.stateNode = {
				autoName: null,
				paired: null,
				clones: null,
				ref: null
			}), r = t.pendingProps, r.name != null && r.name !== "auto" ? t.flags |= e === null ? 18882560 : 18874368 : I && F(t), e !== null && e.memoizedProps.name !== r.name ? t.flags |= 4194816 : Xc(e, t), Bc(e, t, r.children, n), t.child;
			case 29: throw t.pendingProps;
		}
		throw Error(i(156, t.tag));
	}
	function yl(e) {
		e.flags |= 4;
	}
	function bl(e, t, n, r, i) {
		var a;
		if ((a = !!(e.mode & 32)) && (a = n === null ? sh(t, r) : sh(t, r) && (r.src !== n.src || r.srcSet !== n.srcSet)), a) {
			if (e.flags |= 16777216, (i & 335544128) === i) {
				if (e.stateNode.complete) e.flags |= 8192;
				else if (nf()) e.flags |= 8192;
				else throw oo = no, eo;
			}
		} else e.flags &= -16777217;
	}
	function xl(e, t) {
		if (t.type !== "stylesheet" || t.state.loading & 4) e.flags &= -16777217;
		else if (e.flags |= 16777216, !ch(t)) {
			if (nf()) e.flags |= 8192;
			else throw oo = no, eo;
		}
	}
	function Sl(e, t) {
		t !== null && (e.flags |= 4), e.flags & 16384 && (t = e.tag === 22 ? 536870912 : yt(), e.lanes |= t, Cd |= t);
	}
	function Cl(e, t) {
		if (!I) switch (e.tailMode) {
			case "visible": break;
			case "collapsed":
				for (var n = e.tail, r = null; n !== null;) n.alternate !== null && (r = n), n = n.sibling;
				r === null ? t || e.tail === null ? e.tail = null : e.tail.sibling = null : r.sibling = null;
				break;
			default:
				for (t = e.tail, n = null; t !== null;) t.alternate !== null && (n = t), t = t.sibling;
				n === null ? e.tail = null : n.sibling = null;
		}
	}
	function wl(e) {
		var t = e.alternate !== null && e.alternate.child === e.child, n = 0, r = 0;
		if (t) for (var i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags & 1206910976, r |= i.flags & 1206910976, i.return = e, i = i.sibling;
		else for (i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags, r |= i.flags, i.return = e, i = i.sibling;
		return e.subtreeFlags |= r, e.childLanes = n, t;
	}
	function Tl(e, t, n) {
		var r = t.pendingProps;
		switch (aa(t), t.tag) {
			case 16:
			case 15:
			case 0:
			case 11:
			case 7:
			case 8:
			case 12:
			case 9:
			case 14: return wl(t), null;
			case 1: return wl(t), null;
			case 3: return n = t.stateNode, r = null, e !== null && (r = e.memoizedState.cache), t.memoizedState.cache !== r && (t.flags |= 2048), Ca(Fa), Pe(), n.pendingContext && (n.context = n.pendingContext, n.pendingContext = null), (e === null || e.child === null) && (ha(t) ? yl(t) : e === null || e.memoizedState.isDehydrated && !(t.flags & 256) || (t.flags |= 1024, _a())), wl(t), null;
			case 26:
				var a = t.type, o = t.memoizedState;
				return e === null ? (yl(t), o === null ? (wl(t), bl(t, a, null, r, n)) : (wl(t), xl(t, o))) : o ? o === e.memoizedState ? (wl(t), t.flags &= -16777217) : (yl(t), wl(t), xl(t, o)) : (e = e.memoizedProps, e !== r && yl(t), wl(t), bl(t, a, e, r, n)), null;
			case 27:
				if (Ie(t), n = je.current, a = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && yl(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(i(166));
						return wl(t), t.subtreeFlags &= -33554433, null;
					}
					e = ke.current, ha(t) ? pa(t, e) : (e = Am(a, r, n), t.stateNode = e, yl(t));
				}
				return wl(t), t.subtreeFlags &= -33554433, null;
			case 5:
				if (Ie(t), a = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && yl(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(i(166));
						return wl(t), t.subtreeFlags &= -33554433, null;
					}
					if (o = ke.current, ha(t)) pa(t, o);
					else {
						var s = wp(je.current);
						switch (o) {
							case 1:
								o = s.createElementNS("http://www.w3.org/2000/svg", a);
								break;
							case 2:
								o = s.createElementNS("http://www.w3.org/1998/Math/MathML", a);
								break;
							default: switch (a) {
								case "svg":
									o = s.createElementNS("http://www.w3.org/2000/svg", a);
									break;
								case "math":
									o = s.createElementNS("http://www.w3.org/1998/Math/MathML", a);
									break;
								case "script":
									o = s.createElement("div"), o.innerHTML = "<script><\/script>", o = o.removeChild(o.firstChild);
									break;
								case "select":
									o = typeof r.is == "string" ? s.createElement("select", { is: r.is }) : s.createElement("select"), r.multiple ? o.multiple = !0 : r.size && (o.size = r.size);
									break;
								default: o = typeof r.is == "string" ? s.createElement(a, { is: r.is }) : s.createElement(a);
							}
						}
						o[jt] = t, o[Mt] = r;
						a: for (s = t.child; s !== null;) {
							if (s.tag === 5 || s.tag === 6) o.appendChild(s.stateNode);
							else if (s.tag !== 4 && s.tag !== 27 && s.child !== null) {
								s.child.return = s, s = s.child;
								continue;
							}
							if (s === t) break a;
							for (; s.sibling === null;) {
								if (s.return === null || s.return === t) break a;
								s = s.return;
							}
							s.sibling.return = s.return, s = s.sibling;
						}
						t.stateNode = o;
						a: switch (_p(o, a, r), a) {
							case "button":
							case "input":
							case "select":
							case "textarea":
								r = !!r.autoFocus;
								break a;
							case "img":
								r = !0;
								break a;
							default: r = !1;
						}
						r && yl(t);
					}
				}
				return wl(t), t.subtreeFlags &= -33554433, bl(t, t.type, e === null ? null : e.memoizedProps, t.pendingProps, n), null;
			case 6:
				if (e && t.stateNode != null) e.memoizedProps !== r && yl(t);
				else {
					if (typeof r != "string" && t.stateNode === null) throw Error(i(166));
					if (e = je.current, ha(t)) {
						if (e = t.stateNode, n = t.memoizedProps, r = null, a = sa, a !== null) switch (a.tag) {
							case 27:
							case 5: r = a.memoizedProps;
						}
						e[jt] = t, e = !!(e.nodeValue === n || r !== null && !0 === r.suppressHydrationWarning || mp(e.nodeValue, n)), e || fa(t, !0);
					} else e = wp(e).createTextNode(r), e[jt] = t, t.stateNode = e;
				}
				return wl(t), null;
			case 31:
				if (n = t.memoizedState, e === null || e.memoizedState !== null) {
					if (r = ha(t), n !== null) {
						if (e === null) {
							if (!r) throw Error(i(318));
							if (e = t.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(i(557));
							e[jt] = t;
						} else ga(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						wl(t), e = !1;
					} else n = _a(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = n), e = !0;
					if (!e) return t.flags & 256 ? (Vo(t), t) : (Vo(t), null);
					if (t.flags & 128) throw Error(i(558));
				}
				return wl(t), null;
			case 13:
				if (r = t.memoizedState, e === null || e.memoizedState !== null && e.memoizedState.dehydrated !== null) {
					if (a = ha(t), r !== null && r.dehydrated !== null) {
						if (e === null) {
							if (!a) throw Error(i(318));
							if (a = t.memoizedState, a = a === null ? null : a.dehydrated, !a) throw Error(i(317));
							a[jt] = t;
						} else ga(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						wl(t), a = !1;
					} else a = _a(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = a), a = !0;
					if (!a) return t.flags & 256 ? (Vo(t), t) : (Vo(t), null);
				}
				return Vo(t), t.flags & 128 ? (t.lanes = n, t) : (n = r !== null, e = e !== null && e.memoizedState !== null, n && (r = t.child, a = null, r.alternate !== null && r.alternate.memoizedState !== null && r.alternate.memoizedState.cachePool !== null && (a = r.alternate.memoizedState.cachePool.pool), o = null, r.memoizedState !== null && r.memoizedState.cachePool !== null && (o = r.memoizedState.cachePool.pool), o !== a && (r.flags |= 2048)), n !== e && n && (t.child.flags |= 8192), Sl(t, t.updateQueue), wl(t), null);
			case 4: return Pe(), e === null && ip(t.stateNode.containerInfo), t.flags |= 67108864, wl(t), null;
			case 10: return Ca(t.type), wl(t), null;
			case 19:
				if (Wo(t), r = t.memoizedState, r === null) return wl(t), null;
				if (a = !!(t.flags & 128), o = r.rendering, o === null) {
					if (a) Cl(r, !1);
					else {
						if (vd !== 0 || e !== null && e.flags & 128) for (e = t.child; e !== null;) {
							if (o = Go(e), o !== null) {
								for (t.flags |= 128, Cl(r, !1), e = o.updateQueue, t.updateQueue = e, Sl(t, e), t.subtreeFlags = 0, e = n, n = t.child; n !== null;) Hi(n, e), n = n.sibling;
								return Uo(t, Ho.current & 1 | 2), I && P(t, r.treeForkCount), t.child;
							}
							e = e.sibling;
						}
						r.tail !== null && Ye() > kd && (t.flags |= 128, a = !0, Cl(r, !1), t.lanes = 4194304);
					}
				} else {
					if (!a) {
						if (e = Go(o), e !== null) {
							if (t.flags |= 128, a = !0, e = e.updateQueue, t.updateQueue = e, Sl(t, e), Cl(r, !0), r.tail === null && r.tailMode !== "collapsed" && r.tailMode !== "visible" && !o.alternate && !I) return wl(t), null;
						} else 2 * Ye() - r.renderingStartTime > kd && n !== 536870912 && (t.flags |= 128, a = !0, Cl(r, !1), t.lanes = 4194304);
					}
					r.isBackwards ? (o.sibling = t.child, t.child = o) : (e = r.last, e === null ? t.child = o : e.sibling = o, r.last = o);
				}
				if (r.tail !== null) {
					e = r.tail;
					a: {
						for (n = e; n !== null;) {
							if (n.alternate !== null) {
								n = !1;
								break a;
							}
							n = n.sibling;
						}
						n = !0;
					}
					return r.rendering = e, r.tail = e.sibling, r.renderingStartTime = Ye(), e.sibling = null, o = Ho.current, o = a ? o & 1 | 2 : o & 1, r.tailMode === "visible" || r.tailMode === "collapsed" || !n || I ? Uo(t, o) : (n = o, Oe(Fo, t), Oe(Ho, n), Io === null && (Io = t)), I && P(t, r.treeForkCount), e;
				}
				return wl(t), null;
			case 22:
			case 23: return Vo(t), Po(), r = t.memoizedState !== null, e === null ? r && (t.flags |= 8192) : e.memoizedState !== null !== r && (t.flags |= 8192), r ? n & 536870912 && !(t.flags & 128) && (wl(t), t.subtreeFlags & 6 && (t.flags |= 8192)) : wl(t), n = t.updateQueue, n !== null && Sl(t, n.retryQueue), n = null, e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), r = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (r = t.memoizedState.cachePool.pool), r !== n && (t.flags |= 2048), e !== null && De(Ya), null;
			case 24: return n = null, e !== null && (n = e.memoizedState.cache), t.memoizedState.cache !== n && (t.flags |= 2048), Ca(Fa), wl(t), null;
			case 25: return null;
			case 30: return t.flags |= 33554432, wl(t), null;
		}
		throw Error(i(156, t.tag));
	}
	function El(e, t) {
		switch (aa(t), t.tag) {
			case 1: return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 3: return Ca(Fa), Pe(), e = t.flags, e & 65536 && !(e & 128) ? (t.flags = e & -65537 | 128, t) : null;
			case 26:
			case 27:
			case 5: return Ie(t), null;
			case 31:
				if (t.memoizedState !== null) {
					if (Vo(t), t.alternate === null) throw Error(i(340));
					ga();
				}
				return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 13:
				if (Vo(t), e = t.memoizedState, e !== null && e.dehydrated !== null) {
					if (t.alternate === null) throw Error(i(340));
					ga();
				}
				return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 19: return Wo(t), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, e = t.memoizedState, e !== null && (e.rendering = null, e.tail = null), t.flags |= 4, t) : null;
			case 4: return Pe(), null;
			case 10: return Ca(t.type), null;
			case 22:
			case 23: return Vo(t), Po(), e !== null && De(Ya), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 24: return Ca(Fa), null;
			case 25: return null;
			default: return null;
		}
	}
	function Dl(e, t) {
		switch (aa(t), t.tag) {
			case 3:
				Ca(Fa), Pe();
				break;
			case 26:
			case 27:
			case 5:
				Ie(t);
				break;
			case 4:
				Pe();
				break;
			case 31:
				t.memoizedState !== null && Vo(t);
				break;
			case 13:
				Vo(t);
				break;
			case 19:
				Wo(t);
				break;
			case 10:
				Ca(t.type);
				break;
			case 22:
			case 23:
				Vo(t), Po(), e !== null && De(Ya);
				break;
			case 24: Ca(Fa);
		}
	}
	function Ol(e, t) {
		try {
			var n = t.updateQueue, r = n === null ? null : n.lastEffect;
			if (r !== null) {
				var i = r.next;
				n = i;
				do {
					if ((n.tag & e) === e) {
						r = void 0;
						var a = n.create, o = n.inst;
						r = a(), o.destroy = r;
					}
					n = n.next;
				} while (n !== i);
			}
		} catch (e) {
			Df(t, t.return, e);
		}
	}
	function kl(e, t, n) {
		try {
			var r = t.updateQueue, i = r === null ? null : r.lastEffect;
			if (i !== null) {
				var a = i.next;
				r = a;
				do {
					if ((r.tag & e) === e) {
						var o = r.inst, s = o.destroy;
						if (s !== void 0) {
							o.destroy = void 0, i = t;
							var c = n, l = s;
							try {
								l();
							} catch (e) {
								Df(i, c, e);
							}
						}
					}
					r = r.next;
				} while (r !== a);
			}
		} catch (e) {
			Df(t, t.return, e);
		}
	}
	function Al(e) {
		var t = e.updateQueue;
		if (t !== null) {
			var n = e.stateNode;
			try {
				ko(t, n);
			} catch (t) {
				Df(e, e.return, t);
			}
		}
	}
	function jl(e, t, n) {
		n.props = Oc(e.type, e.memoizedProps), n.state = e.memoizedState;
		try {
			n.componentWillUnmount();
		} catch (n) {
			Df(e, t, n);
		}
	}
	function Ml(e, t) {
		try {
			var n = e.ref;
			if (n !== null) {
				switch (e.tag) {
					case 26:
					case 27:
					case 5:
						var r = e.stateNode;
						break;
					case 30:
						var i = e.stateNode, a = wi(e.memoizedProps, i);
						(i.ref === null || i.ref.name !== a) && (i.ref = Yp(a)), r = i.ref;
						break;
					case 7:
						if (e.stateNode === null) {
							var o = new Xp(e);
							h(e.child, !1, pm, o, void 0, void 0), e.stateNode = o;
						}
						r = e.stateNode;
						break;
					default: r = e.stateNode;
				}
				typeof n == "function" ? e.refCleanup = n(r) : n.current = r;
			}
		} catch (n) {
			Df(e, t, n);
		}
	}
	function Nl(e, t) {
		var n = e.ref, r = e.refCleanup;
		if (n !== null) {
			if (typeof r == "function") try {
				r();
			} catch (n) {
				Df(e, t, n);
			} finally {
				e.refCleanup = null, e = e.alternate, e != null && (e.refCleanup = null);
			}
			else if (typeof n == "function") try {
				n(null);
			} catch (n) {
				Df(e, t, n);
			}
			else n.current = null;
		}
	}
	function Pl(e, t) {
		if ((e.tag === 5 || e.tag === 27 || e.tag === 6) && e.alternate === null && t !== null) for (var n = 0; n < t.length; n++) hm(e.stateNode, t[n]);
	}
	function Fl(e) {
		for (var t = e.return; t !== null && (Rl(t) && hm(e.stateNode, t.stateNode), !Ll(t));) t = t.return;
	}
	function Il(e) {
		for (var t = e.return; t !== null && (Rl(t) && gm(e.stateNode, t.stateNode), !Ll(t));) t = t.return;
	}
	function Ll(e) {
		return e.tag === 5 || e.tag === 3 || e.tag === 27;
	}
	function Rl(e) {
		return e && e.tag === 7 && e.stateNode !== null;
	}
	function zl(e) {
		var t = e.type, n = e.memoizedProps, r = e.stateNode;
		try {
			a: switch (t) {
				case "button":
				case "input":
				case "select":
				case "textarea":
					n.autoFocus && r.focus();
					break a;
				case "img": n.src ? r.src = n.src : n.srcSet && (r.srcset = n.srcSet);
			}
		} catch (t) {
			Df(e, e.return, t);
		}
	}
	function Bl(e, t, n) {
		try {
			var r = e.stateNode;
			yp(r, e.type, n, t), r[Mt] = t;
		} catch (t) {
			Df(e, e.return, t);
		}
	}
	function Vl(e) {
		return e.tag === 5 || e.tag === 3 || e.tag === 26 || e.tag === 27 && Lp(e.type) || e.tag === 4;
	}
	function Hl(e) {
		a: for (;;) {
			for (; e.sibling === null;) {
				if (e.return === null || Vl(e.return)) return null;
				e = e.return;
			}
			for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18;) {
				if (e.tag === 27 && Lp(e.type) || e.flags & 2 || e.child === null || e.tag === 4) continue a;
				e.child.return = e, e = e.child;
			}
			if (!(e.flags & 2)) return e.stateNode;
		}
	}
	function Ul(e, t, n, r) {
		var i = e.tag;
		if (i === 5 || i === 6) i = e.stateNode, t ? (n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n).insertBefore(i, t) : (t = n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n, t.appendChild(i), n = n._reactRootContainer, n != null || t.onclick !== null || (t.onclick = Dn)), Pl(e, r), tn = !0;
		else if (i !== 4 && (i === 27 && (Pl(e, r), r = null, Lp(e.type) && (n = e.stateNode, t = null)), e = e.child, e !== null)) for (Ul(e, t, n, r), e = e.sibling; e !== null;) Ul(e, t, n, r), e = e.sibling;
	}
	function Wl(e, t, n, r) {
		var i = e.tag;
		if (i === 5 || i === 6) i = e.stateNode, t ? n.insertBefore(i, t) : n.appendChild(i), Pl(e, r), tn = !0;
		else if (i !== 4 && (i === 27 && (Pl(e, r), r = null, Lp(e.type) && (n = e.stateNode)), e = e.child, e !== null)) for (Wl(e, t, n, r), e = e.sibling; e !== null;) Wl(e, t, n, r), e = e.sibling;
	}
	function Gl(e) {
		var t = e.stateNode, n = e.memoizedProps;
		try {
			for (var r = e.type, i = t.attributes; i.length;) t.removeAttributeNode(i[0]);
			_p(t, r, n), t[jt] = e, t[Mt] = n;
		} catch (t) {
			Df(e, e.return, t);
		}
	}
	var Kl = !1, ql = null;
	function Jl(e) {
		(e.tag === 30 || e.subtreeFlags & 33554432) && (Kl = !0);
	}
	var Yl = null;
	function Xl() {
		var e = Yl;
		return Yl = null, e;
	}
	var Zl = 0;
	function Ql(e, t, n, r, i) {
		return Zl = 0, $l(e.child, t, n, r, i);
	}
	function $l(e, t, n, r, i) {
		for (var a = !1; e !== null;) {
			if (e.tag === 5) {
				var o = e.stateNode;
				if (r !== null) {
					var s = Up(o);
					r.push(s), s.view && (a = !0);
				} else a || Up(o).view && (a = !0);
				Kl = !0, Bp(o, Zl === 0 ? t : t + "_" + Zl, n), Zl++;
			} else (e.tag !== 22 || e.memoizedState === null) && (e.tag === 30 && i || $l(e.child, t, n, r, i) && (a = !0));
			e = e.sibling;
		}
		return a;
	}
	function eu(e, t) {
		for (; e !== null;) e.tag === 5 ? Vp(e.stateNode, e.memoizedProps) : (e.tag !== 22 || e.memoizedState === null) && (e.tag === 30 && t || eu(e.child, t)), e = e.sibling;
	}
	function tu(e) {
		if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
			if ((e.tag !== 22 || e.memoizedState === null) && (tu(e), e.tag === 30 && e.flags & 18874368 && e.stateNode.paired)) {
				var t = e.memoizedProps;
				if (t.name == null || t.name === "auto") throw Error(i(544));
				var n = t.name;
				t = Ei(t.default, t.share), t !== "none" && (Ql(e, n, t, null, !1) || eu(e.child, !1));
			}
			e = e.sibling;
		}
	}
	function nu(e, t) {
		if (e.tag === 30) {
			var n = e.stateNode, r = e.memoizedProps, i = wi(r, n), a = Ei(r.default, n.paired ? r.share : r.enter);
			a === "none" ? tu(e) : Ql(e, i, a, null, !1) ? (tu(e), n.paired || t || Kd(e, r.onEnter)) : eu(e.child, !1);
		} else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) nu(e, t), e = e.sibling;
		else tu(e);
	}
	function ru(e) {
		if (ql !== null && ql.size !== 0) {
			var t = ql;
			if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
				if (e.tag !== 22 || e.memoizedState === null) {
					if (e.tag === 30 && e.flags & 18874368) {
						var n = e.memoizedProps, r = n.name;
						if (r != null && r !== "auto") {
							var i = t.get(r);
							if (i !== void 0) {
								var a = Ei(n.default, n.share);
								if (a !== "none" && (Ql(e, r, a, null, !1) ? (a = e.stateNode, i.paired = a, a.paired = i, Kd(e, n.onShare)) : eu(e.child, !1)), t.delete(r), t.size === 0) break;
							}
						}
					}
					ru(e);
				}
				e = e.sibling;
			}
		}
	}
	function iu(e) {
		if (e.tag === 30) {
			var t = e.memoizedProps, n = wi(t, e.stateNode), r = ql === null ? void 0 : ql.get(n), i = Ei(t.default, r === void 0 ? t.exit : t.share);
			i !== "none" && (Ql(e, n, i, null, !1) ? r === void 0 ? Kd(e, t.onExit) : (i = e.stateNode, r.paired = i, i.paired = r, ql.delete(n), Kd(e, t.onShare)) : eu(e.child, !1)), ql !== null && ru(e);
		} else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) iu(e), e = e.sibling;
		else ql !== null && ru(e);
	}
	function au(e) {
		for (e = e.child; e !== null;) {
			if (e.tag === 30) {
				var t = e.memoizedProps, n = wi(t, e.stateNode);
				t = Ei(t.default, t.update), e.flags &= -5, t !== "none" && Ql(e, n, t, e.memoizedState = [], !1);
			} else e.subtreeFlags & 33554432 && au(e);
			e = e.sibling;
		}
	}
	function ou(e) {
		if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
			if (e.tag !== 22 || e.memoizedState === null) {
				if (e.tag === 30 && e.flags & 18874368) {
					var t = e.stateNode;
					t.paired !== null && (t.paired = null, eu(e.child, !1));
				}
				ou(e);
			}
			e = e.sibling;
		}
	}
	function su(e) {
		if (e.tag === 30) e.stateNode.paired = null, eu(e.child, !1), ou(e);
		else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) su(e), e = e.sibling;
		else ou(e);
	}
	function cu(e) {
		for (e = e.child; e !== null;) e.tag === 30 ? eu(e.child, !1) : e.subtreeFlags & 33554432 && cu(e), e = e.sibling;
	}
	function lu(e, t, n, r, i, a, o) {
		for (var s = !1; t !== null;) {
			if (t.tag === 5) {
				var c = t.stateNode;
				if (a !== null && Zl < a.length) {
					var l = a[Zl], u = Up(c);
					(l.view || u.view) && (s = !0);
					var d;
					if (d = !(e.flags & 4)) {
						if (u.clip) d = !0;
						else {
							d = l.rect;
							var f = u.rect;
							d = d.y !== f.y || d.x !== f.x || d.height !== f.height || d.width !== f.width;
						}
					}
					d && (e.flags |= 4), u.abs ? u = !l.abs : (l = l.rect, u = u.rect, u = l.height !== u.height || l.width !== u.width), u && (e.flags |= 32);
				} else e.flags |= 32;
				e.flags & 4 && Bp(c, Zl === 0 ? n : n + "_" + Zl, i), s && e.flags & 4 || (Yl === null && (Yl = []), Yl.push(c, Zl === 0 ? r : r + "_" + Zl, t.memoizedProps)), Zl++;
			} else (t.tag !== 22 || t.memoizedState === null) && (t.tag === 30 && o ? e.flags |= t.flags & 32 : lu(e, t.child, n, r, i, a, o) && (s = !0));
			t = t.sibling;
		}
		return s;
	}
	function uu(e, t) {
		for (e = e.child; e !== null;) {
			if (e.tag === 30) {
				var n = e.memoizedProps, r = e.stateNode, i = wi(n, r), a = Ei(n.default, n.update);
				if (t) {
					r = r.clones;
					var o = r === null ? null : r.map(Wp);
				} else o = e.memoizedState, e.memoizedState = null;
				r = e;
				var s = e.child;
				Zl = 0, i = lu(r, s, i, i, a, o, !1), e.flags & 4 && i && (t || Kd(e, n.onUpdate));
			} else e.subtreeFlags & 33554432 && uu(e, t);
			e = e.sibling;
		}
	}
	var du = !1, fu = !1, pu = !1, mu = !1, hu = typeof WeakSet == "function" ? WeakSet : Set, gu = null, _u = !1, vu = !1, yu = !1, bu = !1;
	function xu(e, t, n) {
		if (e = e.containerInfo, Sp = kh, e = ei(e), ti(e)) {
			if ("selectionStart" in e) var r = {
				start: e.selectionStart,
				end: e.selectionEnd
			};
			else a: {
				r = (r = e.ownerDocument) && r.defaultView || window;
				var i = r.getSelection && r.getSelection();
				if (i && i.rangeCount !== 0) {
					r = i.anchorNode;
					var a = i.anchorOffset, o = i.focusNode;
					i = i.focusOffset;
					try {
						r.nodeType, o.nodeType;
					} catch {
						r = null;
						break a;
					}
					var s = 0, c = -1, l = -1, u = 0, d = 0, f = e, p = null;
					b: for (;;) {
						for (var m; f !== r || a !== 0 && f.nodeType !== 3 || (c = s + a), f !== o || i !== 0 && f.nodeType !== 3 || (l = s + i), f.nodeType === 3 && (s += f.nodeValue.length), (m = f.firstChild) !== null;) p = f, f = m;
						for (;;) {
							if (f === e) break b;
							if (p === r && ++u === a && (c = s), p === o && ++d === i && (l = s), (m = f.nextSibling) !== null) break;
							f = p, p = f.parentNode;
						}
						f = m;
					}
					r = c === -1 || l === -1 ? null : {
						start: c,
						end: l
					};
				} else r = null;
			}
			r ||= {
				start: 0,
				end: 0
			};
		} else r = null;
		for (Cp = {
			focusedElem: e,
			selectionRange: r
		}, kh = !1, n = (n & 335544064) === n, gu = t, t = n ? 9270 : 1024; gu !== null;) {
			if (e = gu, n && (r = e.deletions, r !== null)) for (a = 0; a < r.length; a++) n && iu(r[a]);
			if (e.alternate === null && e.flags & 2) n && Jl(e), Su(n);
			else {
				if (e.tag === 22) {
					if (r = e.alternate, e.memoizedState !== null) {
						r !== null && r.memoizedState === null && n && iu(r), Su(n);
						continue;
					}
					if (r !== null && r.memoizedState !== null) {
						n && Jl(e), Su(n);
						continue;
					}
				}
				r = e.child, (e.subtreeFlags & t) !== 0 && r !== null ? (r.return = e, gu = r) : (n && au(e), Su(n));
			}
		}
		ql = null;
	}
	function Su(e) {
		for (; gu !== null;) {
			var t = gu, n = e, r = t.alternate, a = t.flags;
			switch (t.tag) {
				case 0:
				case 11:
				case 15: break;
				case 1:
					if (a & 1024 && r !== null) {
						n = void 0, a = r.memoizedProps, r = r.memoizedState;
						var o = t.stateNode;
						try {
							var s = Oc(t.type, a);
							n = o.getSnapshotBeforeUpdate(s, r), o.__reactInternalSnapshotBeforeUpdate = n;
						} catch (e) {
							Df(t, t.return, e);
						}
					}
					break;
				case 3:
					if (a & 1024) {
						if (r = t.stateNode.containerInfo, n = r.nodeType, n === 9) _m(r);
						else if (n === 1) switch (r.nodeName) {
							case "HEAD":
							case "HTML":
							case "BODY":
								_m(r);
								break;
							default: r.textContent = "";
						}
					}
					break;
				case 5:
				case 26:
				case 27:
				case 6:
				case 4:
				case 17: break;
				case 30:
					n && r !== null && (n = wi(r.memoizedProps, r.stateNode), a = t.memoizedProps, a = Ei(a.default, a.update), a !== "none" && Ql(r, n, a, r.memoizedState = [], !0));
					break;
				default: if (a & 1024) throw Error(i(163));
			}
			if (r = t.sibling, r !== null) {
				r.return = t.return, gu = r;
				break;
			}
			gu = t.return;
		}
	}
	function Cu(e, t, n) {
		var r = n.flags;
		switch (n.tag) {
			case 0:
			case 11:
			case 15:
				Uu(e, n), r & 4 && Ol(5, n);
				break;
			case 1:
				if (Uu(e, n), r & 4) {
					if (e = n.stateNode, t === null) try {
						e.componentDidMount();
					} catch (e) {
						Df(n, n.return, e);
					}
					else {
						var i = Oc(n.type, t.memoizedProps);
						t = t.memoizedState;
						try {
							e.componentDidUpdate(i, t, e.__reactInternalSnapshotBeforeUpdate);
						} catch (e) {
							Df(n, n.return, e);
						}
					}
				}
				r & 64 && Al(n), r & 512 && Ml(n, n.return);
				break;
			case 3:
				if (Uu(e, n), r & 64 && (e = n.updateQueue, e !== null)) {
					if (t = null, n.child !== null) switch (n.child.tag) {
						case 27:
						case 5:
							t = n.child.stateNode;
							break;
						case 1: t = n.child.stateNode;
					}
					try {
						ko(e, t);
					} catch (e) {
						Df(n, n.return, e);
					}
				}
				break;
			case 27: t === null && r & 4 && Gl(n);
			case 26:
			case 5:
				Uu(e, n), t === null && r & 4 && zl(n), r & 512 && Ml(n, n.return);
				break;
			case 12:
				Uu(e, n);
				break;
			case 31:
				Uu(e, n), r & 4 && Mu(e, n);
				break;
			case 13:
				Uu(e, n), r & 4 && Nu(e, n), r & 64 && (e = n.memoizedState, e !== null && (e = e.dehydrated, e !== null && (n = jf.bind(null, n), Cm(e, n))));
				break;
			case 22:
				if (r = n.memoizedState !== null || du, !r) {
					var a = t !== null && t.memoizedState !== null || fu;
					t = du, i = fu, du = r, (fu = a) && !i ? (r = 2, n.subtreeFlags & 8772 && (r |= 1), Gu(e, n, r)) : Uu(e, n), du = t, fu = i;
				}
				break;
			case 30:
				Uu(e, n), r & 512 && Ml(n, n.return);
				break;
			case 7: r & 512 && Ml(n, n.return);
			default: Uu(e, n);
		}
	}
	function wu(e, t) {
		for (e = e.child; e !== null;) Tu(e, t), e = e.sibling;
	}
	function Tu(e, t) {
		switch (e.tag) {
			case 5:
			case 26:
				try {
					var n = e.stateNode;
					if (t) {
						var r = n.style;
						typeof r.setProperty == "function" ? r.setProperty("display", "none", "important") : r.display = "none";
					} else {
						var i = e.stateNode, a = e.memoizedProps.style, o = a != null && a.hasOwnProperty("display") ? a.display : null;
						i.style.display = o == null || typeof o == "boolean" ? "" : ("" + o).trim();
					}
				} catch (t) {
					Df(e, e.return, t);
				}
				Eu(e, t);
				break;
			case 6:
				try {
					e.stateNode.nodeValue = t ? "" : e.memoizedProps, tn = !0;
				} catch (t) {
					Df(e, e.return, t);
				}
				break;
			case 18:
				try {
					var s = e.stateNode;
					t ? zp(s, !0) : zp(e.stateNode, !1);
				} catch (t) {
					Df(e, e.return, t);
				}
				break;
			case 22:
			case 23:
				e.memoizedState === null && wu(e, t);
				break;
			default: wu(e, t);
		}
	}
	function Eu(e, t) {
		if (e.subtreeFlags & 67108864) for (e = e.child; e !== null;) {
			a: {
				var n = e, r = t;
				switch (n.tag) {
					case 4:
						Tu(n, r);
						break a;
					case 22:
						n.memoizedState === null && Eu(n, r);
						break a;
					default: Eu(n, r);
				}
			}
			e = e.sibling;
		}
	}
	function Du(e) {
		var t = e.alternate;
		t !== null && (e.alternate = null, Du(t)), e.child = null, e.deletions = null, e.sibling = null, e.tag === 5 && (t = e.stateNode, t !== null && Bt(t)), e.stateNode = null, e.return = null, e.dependencies = null, e.memoizedProps = null, e.memoizedState = null, e.pendingProps = null, e.stateNode = null, e.updateQueue = null;
	}
	var Ou = null, ku = !1;
	function Au(e, t, n) {
		for (n = n.child; n !== null;) ju(e, t, n), n = n.sibling;
	}
	function ju(e, t, n) {
		if (at && typeof at.onCommitFiberUnmount == "function") try {
			at.onCommitFiberUnmount(it, n);
		} catch {}
		switch (n.tag) {
			case 26:
				fu || Nl(n, t), Au(e, t, n), n.memoizedState ? n.memoizedState.count-- : n.stateNode && !fu && (n = n.stateNode, n.parentNode.removeChild(n));
				break;
			case 27:
				fu || Nl(n, t), Il(n);
				var r = Ou, i = ku;
				Lp(n.type) && (Ou = n.stateNode, ku = !1), Au(e, t, n), jm(n.stateNode, n.type, n.memoizedProps), Ou = r, ku = i;
				break;
			case 5: fu || Nl(n, t), Il(n);
			case 6:
				if (n.tag === 6 && Il(n), r = Ou, i = ku, Ou = null, Au(e, t, n), Ou = r, ku = i, Ou !== null) {
					if (ku) try {
						(Ou.nodeType === 9 ? Ou.body : Ou.nodeName === "HTML" ? Ou.ownerDocument.body : Ou).removeChild(n.stateNode), tn = !0;
					} catch (e) {
						Df(n, t, e);
					}
					else try {
						Ou.removeChild(n.stateNode), tn = !0;
					} catch (e) {
						Df(n, t, e);
					}
				}
				break;
			case 18:
				Ou !== null && (ku ? (e = Ou, Rp(e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, n.stateNode), Zh(e)) : Rp(Ou, n.stateNode));
				break;
			case 4:
				r = Ou, i = ku, Ou = n.stateNode.containerInfo, ku = !0, Au(e, t, n), Ou = r, ku = i;
				break;
			case 0:
			case 11:
			case 14:
			case 15:
				kl(2, n, t), fu || kl(4, n, t), Au(e, t, n);
				break;
			case 1:
				fu || (Nl(n, t), r = n.stateNode, typeof r.componentWillUnmount == "function" && jl(n, t, r)), Au(e, t, n);
				break;
			case 21:
				Au(e, t, n);
				break;
			case 22:
				fu = (r = fu) || n.memoizedState !== null, Au(e, t, n), fu = r;
				break;
			case 30:
				Nl(n, t), Au(e, t, n);
				break;
			case 7:
				fu || Nl(n, t), Au(e, t, n);
				break;
			default: Au(e, t, n);
		}
	}
	function Mu(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null))) {
			e = e.dehydrated;
			try {
				Zh(e);
			} catch (e) {
				Df(t, t.return, e);
			}
		}
	}
	function Nu(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null && (e = e.dehydrated, e !== null)))) try {
			Zh(e);
		} catch (e) {
			Df(t, t.return, e);
		}
	}
	function Pu(e) {
		switch (e.tag) {
			case 31:
			case 13:
			case 19:
				var t = e.stateNode;
				return t === null && (t = e.stateNode = new hu()), t;
			case 22: return e = e.stateNode, t = e._retryCache, t === null && (t = e._retryCache = new hu()), t;
			default: throw Error(i(435, e.tag));
		}
	}
	function Fu(e, t) {
		var n = Pu(e);
		t.forEach(function(t) {
			if (!n.has(t)) {
				n.add(t);
				var r = Mf.bind(null, e, t);
				t.then(r, r);
			}
		});
	}
	function Iu(e, t, n) {
		var r = t.deletions;
		if (r !== null) for (var a = 0; a < r.length; a++) {
			var o = r[a], s = e, c = t, l = c;
			a: for (; l !== null;) {
				switch (l.tag) {
					case 27:
						if (Lp(l.type)) {
							Ou = l.stateNode, ku = !1;
							break a;
						}
						break;
					case 5:
						Ou = l.stateNode, ku = !1;
						break a;
					case 3:
					case 4:
						Ou = l.stateNode.containerInfo, ku = !0;
						break a;
				}
				l = l.return;
			}
			if (Ou === null) throw Error(i(160));
			ju(s, c, o), Ou = null, ku = !1, s = o.alternate, s !== null && (s.return = null), o.return = null;
		}
		if (t.subtreeFlags & 13886) for (t = t.child; t !== null;) Ru(t, e, n), t = t.sibling;
	}
	var Lu = null;
	function Ru(e, t, n) {
		var r = e.alternate, a = e.flags;
		switch (e.tag) {
			case 0:
			case 11:
			case 14:
			case 15:
				if (a & 4 && (r = e.updateQueue, r = r === null ? null : r.events, r !== null)) for (var o = 0; o < r.length; o++) {
					var s = r[o];
					s.ref.impl = s.nextImpl;
				}
				Iu(t, e, n), zu(e), a & 4 && (kl(3, e, e.return), Ol(3, e), kl(5, e, e.return));
				break;
			case 1:
				Iu(t, e, n), zu(e), a & 512 && (fu || r === null || Nl(r, r.return)), a & 64 && du && (e = e.updateQueue, e !== null && (t = e.callbacks, t !== null && (n = e.shared.hiddenCallbacks, e.shared.hiddenCallbacks = n === null ? t : n.concat(t))));
				break;
			case 26:
				if (o = Lu, Iu(t, e, n), zu(e), a & 512 && (fu || r === null || Nl(r, r.return)), a & 4) {
					if (a = r === null ? null : r.memoizedState, n = e.memoizedState, r === null) {
						if (n === null) {
							if (e.stateNode === null) {
								if (du) e.stateNode = Dp(e.type, e.memoizedProps, t.containerInfo, e);
								else {
									a: {
										t = e.type, n = e.memoizedProps, a = o.ownerDocument || o;
										b: switch (t) {
											case "title":
												r = a.getElementsByTagName("title")[0], (!r || r[Rt] || r[jt] || r.namespaceURI === "http://www.w3.org/2000/svg" || r.hasAttribute("itemprop")) && (r = a.createElement(t), a.head.insertBefore(r, a.querySelector("head > title"))), _p(r, t, n), r[jt] = e, Gt(r), t = r;
												break a;
											case "link":
												if (o = ih("link", "href", a).get(t + (n.href || ""))) {
													for (s = 0; s < o.length; s++) if (r = o[s], r.getAttribute("href") === (n.href == null || n.href === "" ? null : n.href) && r.getAttribute("rel") === (n.rel == null ? null : n.rel) && r.getAttribute("title") === (n.title == null ? null : n.title) && r.getAttribute("crossorigin") === (n.crossOrigin == null ? null : n.crossOrigin)) {
														o.splice(s, 1);
														break b;
													}
												}
												r = a.createElement(t), _p(r, t, n), a.head.appendChild(r);
												break;
											case "meta":
												if (o = ih("meta", "content", a).get(t + (n.content || ""))) {
													for (s = 0; s < o.length; s++) if (r = o[s], r.getAttribute("content") === (n.content == null ? null : "" + n.content) && r.getAttribute("name") === (n.name == null ? null : n.name) && r.getAttribute("property") === (n.property == null ? null : n.property) && r.getAttribute("http-equiv") === (n.httpEquiv == null ? null : n.httpEquiv) && r.getAttribute("charset") === (n.charSet == null ? null : n.charSet)) {
														o.splice(s, 1);
														break b;
													}
												}
												r = a.createElement(t), _p(r, t, n), a.head.appendChild(r);
												break;
											default: throw Error(i(468, t));
										}
										r[jt] = e, Gt(r), t = r;
									}
									e.stateNode = t;
								}
							} else du || ah(o, e.type, e.stateNode);
						} else e.stateNode = B(o, n, e.memoizedProps);
					} else a === n ? n === null && e.stateNode !== null && Bl(e, e.memoizedProps, r.memoizedProps) : (a === null ? (t = r.stateNode, t === null || fu || t.parentNode.removeChild(t)) : a.count--, n === null ? du || ah(o, e.type, e.stateNode) : B(o, n, e.memoizedProps));
				}
				break;
			case 27:
				Iu(t, e, n), zu(e), a & 512 && (fu || r === null || Nl(r, r.return)), r !== null && a & 4 && Bl(e, e.memoizedProps, r.memoizedProps);
				break;
			case 5:
				if (o = pu, pu = !1, Iu(t, e, n), pu = o, zu(e), a & 512 && (fu || r === null || Nl(r, r.return)), e.flags & 32) {
					t = e.stateNode;
					try {
						yn(t, ""), tn = !0;
					} catch (t) {
						Df(e, e.return, t);
					}
				}
				a & 4 && e.stateNode != null && (t = e.memoizedProps, Bl(e, t, r === null ? t : r.memoizedProps)), a & 1024 && (mu = !0);
				break;
			case 6:
				if (Iu(t, e, n), zu(e), a & 4) {
					if (e.stateNode === null) throw Error(i(162));
					t = e.memoizedProps, n = e.stateNode;
					try {
						n.nodeValue = t, tn = !0;
					} catch (t) {
						Df(e, e.return, t);
					}
				}
				break;
			case 3:
				if (tn = !1, rh = null, o = Lu, Lu = Fm(t.containerInfo), Iu(t, e, n), Lu = o, zu(e), a & 4 && r !== null && r.memoizedState.isDehydrated) try {
					Zh(t.containerInfo);
				} catch (t) {
					Df(e, e.return, t);
				}
				mu && (mu = !1, Bu(e)), tn = !1;
				break;
			case 4:
				a = pu, pu = du, r = nn(), o = Lu, Lu = Fm(e.stateNode.containerInfo), Iu(t, e, n), zu(e), Lu = o, tn && vu && (yu = !0), tn = r, pu = a;
				break;
			case 12:
				Iu(t, e, n), zu(e);
				break;
			case 31:
				Iu(t, e, n), zu(e), a & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Fu(e, t)));
				break;
			case 13:
				Iu(t, e, n), zu(e), e.child.flags & 8192 && e.memoizedState !== null != (r !== null && r.memoizedState !== null) && (Dd = Ye()), a & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Fu(e, t)));
				break;
			case 22:
				o = e.memoizedState !== null, s = r !== null && r.memoizedState !== null;
				var c = du, l = fu, u = pu;
				du = c || o, pu = u || o, fu = l || s, Iu(t, e, n), fu = l, pu = u, du = c, zu(e), a & 8192 && (t = e.stateNode, t._visibility = o ? t._visibility & -2 : t._visibility | 1, !o || r === null || s || du || fu || (t = s || fu, n = du, r = fu, du = o || du, fu = t, Wu(e, 2), du = n, fu = r), !o && pu || wu(e, o)), a & 4 && (t = e.updateQueue, t !== null && (n = t.retryQueue, n !== null && (t.retryQueue = null, Fu(e, n))));
				break;
			case 19:
				Iu(t, e, n), zu(e), a & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Fu(e, t)));
				break;
			case 30:
				a & 512 && (fu || r === null || Nl(r, r.return)), a = nn(), o = vu, s = (n & 335544064) === n, c = e.memoizedProps, vu = s && Ei(c.default, c.update) !== "none", Iu(t, e, n), zu(e), s && r !== null && tn && (e.flags |= 4), vu = o, tn = a;
				break;
			case 21: break;
			case 7: a & 512 && (fu || r === null || Nl(r, r.return)), r && r.stateNode !== null && (r.stateNode._fragmentFiber = e);
			default: Iu(t, e, n), zu(e);
		}
	}
	function zu(e) {
		var t = e.flags;
		if (t & 2) {
			try {
				for (var n, r = e.return; r !== null;) {
					if (Vl(r)) {
						n = r;
						break;
					}
					r = r.return;
				}
				r = null;
				for (var a = e.return; a !== null;) {
					if (Rl(a)) {
						var o = a.stateNode;
						r === null ? r = [o] : r.push(o);
					}
					if (Ll(a)) break;
					a = a.return;
				}
				var s = r;
				if (n == null) throw Error(i(160));
				switch (n.tag) {
					case 27:
						var c = n.stateNode;
						Wl(e, Hl(e), c, s);
						break;
					case 5:
						var l = n.stateNode;
						n.flags & 32 && (yn(l, ""), n.flags &= -33), Wl(e, Hl(e), l, s);
						break;
					case 3:
					case 4:
						var u = n.stateNode.containerInfo;
						Ul(e, Hl(e), u, s);
						break;
					default: throw Error(i(161));
				}
			} catch (t) {
				Df(e, e.return, t);
			}
			e.flags &= -3;
		}
		t & 4096 && (e.flags &= -4097);
	}
	function Bu(e) {
		if (e.subtreeFlags & 1024) for (e = e.child; e !== null;) {
			var t = e;
			Bu(t), t.tag === 5 && t.flags & 1024 && (t = t.stateNode, kh = !0, t.reset(), kh = !1), e = e.sibling;
		}
	}
	function Vu(e, t) {
		if (t.subtreeFlags & 9270) for (t = t.child; t !== null;) Hu(t, e), t = t.sibling;
		else uu(t, !1);
	}
	function Hu(e, t) {
		var n = e.alternate;
		if (n === null) nu(e, !1);
		else switch (e.tag) {
			case 3:
				if (bu = _u = !1, Xl(), Vu(t, e), !_u && !yu) {
					if (e = Yl, e !== null) for (var r = 0; r < e.length; r += 3) {
						n = e[r];
						var i = e[r + 1];
						Vp(n, e[r + 2]), n = n.ownerDocument.documentElement, n !== null && n.animate({
							opacity: [0, 0],
							pointerEvents: ["none", "none"]
						}, {
							duration: 0,
							fill: "forwards",
							pseudoElement: "::view-transition-group(" + i + ")"
						});
					}
					e = t.containerInfo, e = e.nodeType === 9 ? e.documentElement : e.ownerDocument.documentElement, e !== null && e.style.viewTransitionName === "" && (e.style.viewTransitionName = "none", e.animate({
						opacity: [0, 0],
						pointerEvents: ["none", "none"]
					}, {
						duration: 0,
						fill: "forwards",
						pseudoElement: "::view-transition-group(root)"
					}), e.animate({
						width: [0, 0],
						height: [0, 0]
					}, {
						duration: 0,
						fill: "forwards",
						pseudoElement: "::view-transition"
					})), bu = !0;
				}
				Yl = null;
				break;
			case 5:
				Vu(t, e);
				break;
			case 4:
				r = _u, _u = !1, Vu(t, e), _u && (yu = !0), _u = r;
				break;
			case 22:
				e.memoizedState === null && (n.memoizedState === null ? Vu(t, e) : nu(e, !1));
				break;
			case 30:
				r = _u, i = Xl(), _u = !1, Vu(t, e), _u && (e.flags |= 4);
				var a = e.memoizedProps, o = e.stateNode;
				t = wi(a, o), o = wi(n.memoizedProps, o);
				var s = Ei(a.default, a.update);
				s === "none" ? t = !1 : (a = n.memoizedState, n.memoizedState = null, n = e.child, Zl = 0, t = lu(e, n, t, o, s, a, !0), Zl !== (a === null ? 0 : a.length) && (e.flags |= 32)), e.flags & 4 && t ? (Kd(e, e.memoizedProps.onUpdate), Yl = i) : i !== null && (i.push.apply(i, Yl), Yl = i), _u = e.flags & 32 ? !0 : r;
				break;
			default: Vu(t, e);
		}
	}
	function Uu(e, t) {
		if (t.subtreeFlags & 8772) for (t = t.child; t !== null;) Cu(e, t.alternate, t), t = t.sibling;
	}
	function Wu(e, t) {
		for (e = e.child; e !== null;) {
			var n = e, r = t;
			switch (n.tag) {
				case 0:
				case 11:
				case 14:
				case 15:
					kl(4, n, n.return), Wu(n, r);
					break;
				case 1:
					Nl(n, n.return);
					var i = n.stateNode;
					typeof i.componentWillUnmount == "function" && jl(n, n.return, i), Wu(n, r);
					break;
				case 27: r & 2 && jm(n.stateNode, n.type, n.memoizedProps);
				case 5:
					Nl(n, n.return), n.tag !== 5 && n.tag !== 27 || Il(n), Wu(n, r);
					break;
				case 6:
					Il(n);
					break;
				case 26:
					Nl(n, n.return), i = n.stateNode, n.memoizedState !== null || i === null || fu || i.parentNode.removeChild(i), Wu(n, r);
					break;
				case 22:
					n.memoizedState === null && Wu(n, r);
					break;
				case 30:
					Nl(n, n.return), Wu(n, r);
					break;
				case 7: Nl(n, n.return);
				default: Wu(n, r);
			}
			e = e.sibling;
		}
	}
	function Gu(e, t, n) {
		for (n = t.subtreeFlags & 8772 ? n : n & -2, t = t.child; t !== null;) {
			var r = t.alternate, i = e, a = t, o = a.flags, s = !!(n & 1);
			switch (a.tag) {
				case 0:
				case 11:
				case 15:
					Gu(i, a, n), Ol(4, a);
					break;
				case 1:
					if (Gu(i, a, n), r = a, i = r.stateNode, typeof i.componentDidMount == "function") try {
						i.componentDidMount();
					} catch (e) {
						Df(r, r.return, e);
					}
					if (r = a, i = r.updateQueue, i !== null) {
						var c = r.stateNode;
						try {
							var l = i.shared.hiddenCallbacks;
							if (l !== null) for (i.shared.hiddenCallbacks = null, i = 0; i < l.length; i++) Oo(l[i], c);
						} catch (e) {
							Df(r, r.return, e);
						}
					}
					s && o & 64 && Al(a), Ml(a, a.return);
					break;
				case 27: n & 2 && Gl(a);
				case 5:
					a.tag !== 5 && a.tag !== 27 || Fl(a), Gu(i, a, n), s && r === null && o & 4 && zl(a), Ml(a, a.return);
					break;
				case 6:
					Fl(a);
					break;
				case 26:
					c = a.stateNode, a.memoizedState !== null || c === null || du || ah(Fm(c.ownerDocument), a.type, c), Gu(i, a, n), s && r === null && o & 4 && zl(a), Ml(a, a.return);
					break;
				case 12:
					Gu(i, a, n);
					break;
				case 31:
					Gu(i, a, n), s && o & 4 && Mu(i, a);
					break;
				case 13:
					Gu(i, a, n), s && o & 4 && Nu(i, a);
					break;
				case 22:
					a.memoizedState === null && Gu(i, a, n), Ml(a, a.return);
					break;
				case 30:
					Gu(i, a, n), Ml(a, a.return);
					break;
				case 7: Ml(a, a.return);
				default: Gu(i, a, n);
			}
			t = t.sibling;
		}
	}
	function Ku(e, t) {
		var n = null;
		e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), e = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (e = t.memoizedState.cachePool.pool), e !== n && (e != null && e.refCount++, n != null && La(n));
	}
	function qu(e, t) {
		e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && La(e));
	}
	function Ju(e, t, n, r) {
		var i = (n & 335544064) === n;
		if (t.subtreeFlags & (i ? 10262 : 10256)) for (t = t.child; t !== null;) Yu(e, t, n, r), t = t.sibling;
		else i && cu(t);
	}
	function Yu(e, t, n, r) {
		var i = (n & 335544064) === n;
		i && t.alternate === null && t.return !== null && t.return.alternate !== null && su(t);
		var a = t.flags;
		switch (t.tag) {
			case 0:
			case 11:
			case 15:
				Ju(e, t, n, r), a & 2048 && Ol(9, t);
				break;
			case 1:
				Ju(e, t, n, r);
				break;
			case 3:
				Ju(e, t, n, r), i && bu && (e = e.containerInfo, e = e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, e.style.viewTransitionName === "root" && (e.style.viewTransitionName = ""), e = e.ownerDocument.documentElement, e !== null && e.style.viewTransitionName === "none" && (e.style.viewTransitionName = "")), a & 2048 && (a = null, t.alternate !== null && (a = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== a && (t.refCount++, a != null && La(a)));
				break;
			case 12:
				if (a & 2048) {
					Ju(e, t, n, r), a = t.stateNode;
					try {
						var o = t.memoizedProps, s = o.id, c = o.onPostCommit;
						typeof c == "function" && c(s, t.alternate === null ? "mount" : "update", a.passiveEffectDuration, -0);
					} catch (e) {
						Df(t, t.return, e);
					}
				} else Ju(e, t, n, r);
				break;
			case 31:
				Ju(e, t, n, r);
				break;
			case 13:
				Ju(e, t, n, r);
				break;
			case 23: break;
			case 22:
				o = t.stateNode, s = t.alternate, t.memoizedState === null ? (i && s !== null && s.memoizedState !== null && su(t), o._visibility & 2 ? Ju(e, t, n, r) : (o._visibility |= 2, Xu(e, t, n, r, !!(t.subtreeFlags & 10256) || !1))) : (i && s !== null && s.memoizedState === null && su(s), o._visibility & 2 ? Ju(e, t, n, r) : Zu(e, t)), a & 2048 && Ku(s, t);
				break;
			case 24:
				Ju(e, t, n, r), a & 2048 && qu(t.alternate, t);
				break;
			case 30:
				i && (a = t.alternate, a !== null && (eu(a.child, !0), eu(t.child, !0))), Ju(e, t, n, r);
				break;
			default: Ju(e, t, n, r);
		}
	}
	function Xu(e, t, n, r, i) {
		for (i &&= !!(t.subtreeFlags & 10256) || !1, t = t.child; t !== null;) {
			var a = e, o = t, s = n, c = r, l = o.flags;
			switch (o.tag) {
				case 0:
				case 11:
				case 15:
					Xu(a, o, s, c, i), Ol(8, o);
					break;
				case 23: break;
				case 22:
					var u = o.stateNode;
					o.memoizedState === null ? (u._visibility |= 2, Xu(a, o, s, c, i)) : u._visibility & 2 ? Xu(a, o, s, c, i) : Zu(a, o), i && l & 2048 && Ku(o.alternate, o);
					break;
				case 24:
					Xu(a, o, s, c, i), i && l & 2048 && qu(o.alternate, o);
					break;
				default: Xu(a, o, s, c, i);
			}
			t = t.sibling;
		}
	}
	function Zu(e, t) {
		if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) {
			var n = e, r = t, i = r.flags;
			switch (r.tag) {
				case 22:
					Zu(n, r), i & 2048 && Ku(r.alternate, r);
					break;
				case 24:
					Zu(n, r), i & 2048 && qu(r.alternate, r);
					break;
				default: Zu(n, r);
			}
			t = t.sibling;
		}
	}
	var Qu = 8192;
	function $u(e, t, n) {
		if (e.subtreeFlags & Qu) for (e = e.child; e !== null;) ed(e, t, n), e = e.sibling;
	}
	function ed(e, t, n) {
		switch (e.tag) {
			case 26:
				$u(e, t, n), e.flags & Qu && (e.memoizedState === null ? (e = e.stateNode, (t & 335544128) === t && uh(n, e)) : dh(n, Lu, e.memoizedState, e.memoizedProps));
				break;
			case 5:
				$u(e, t, n), e.flags & Qu && (e = e.stateNode, (t & 335544128) === t && uh(n, e));
				break;
			case 3:
			case 4:
				var r = Lu;
				Lu = Fm(e.stateNode.containerInfo), $u(e, t, n), Lu = r;
				break;
			case 22:
				e.memoizedState === null && (r = e.alternate, r !== null && r.memoizedState !== null ? (r = Qu, Qu = 16777216, $u(e, t, n), Qu = r) : $u(e, t, n));
				break;
			case 30:
				if ((e.flags & Qu) !== 0 && (r = e.memoizedProps.name, r != null && r !== "auto")) {
					var i = e.stateNode;
					i.paired = null, ql === null && (ql = /* @__PURE__ */ new Map()), ql.set(r, i);
				}
				$u(e, t, n);
				break;
			default: $u(e, t, n);
		}
	}
	function td(e) {
		var t = e.alternate;
		if (t !== null && (e = t.child, e !== null)) {
			t.child = null;
			do
				t = e.sibling, e.sibling = null, e = t;
			while (e !== null);
		}
	}
	function nd(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				gu = r, ad(r, e);
			}
			td(e);
		}
		if (e.subtreeFlags & 10256) for (e = e.child; e !== null;) rd(e), e = e.sibling;
	}
	function rd(e) {
		switch (e.tag) {
			case 0:
			case 11:
			case 15:
				nd(e), e.flags & 2048 && kl(9, e, e.return);
				break;
			case 3:
				nd(e);
				break;
			case 12:
				nd(e);
				break;
			case 22:
				var t = e.stateNode;
				e.memoizedState !== null && t._visibility & 2 && (e.return === null || e.return.tag !== 13) ? (t._visibility &= -3, id(e)) : nd(e);
				break;
			default: nd(e);
		}
	}
	function id(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				gu = r, ad(r, e);
			}
			td(e);
		}
		for (e = e.child; e !== null;) {
			switch (t = e, t.tag) {
				case 0:
				case 11:
				case 15:
					kl(8, t, t.return), id(t);
					break;
				case 22:
					n = t.stateNode, n._visibility & 2 && (n._visibility &= -3, id(t));
					break;
				default: id(t);
			}
			e = e.sibling;
		}
	}
	function ad(e, t) {
		for (; gu !== null;) {
			var n = gu;
			switch (n.tag) {
				case 0:
				case 11:
				case 15:
					kl(8, n, t);
					break;
				case 23:
				case 22:
					if (n.memoizedState !== null && n.memoizedState.cachePool !== null) {
						var r = n.memoizedState.cachePool.pool;
						r != null && r.refCount++;
					}
					break;
				case 24: La(n.memoizedState.cache);
			}
			if (r = n.child, r !== null) r.return = n, gu = r;
			else a: for (n = e; gu !== null;) {
				r = gu;
				var i = r.sibling, a = r.return;
				if (Du(r), r === n) {
					gu = null;
					break a;
				}
				if (i !== null) {
					i.return = a, gu = i;
					break a;
				}
				gu = a;
			}
		}
	}
	var od = {
		getCacheForType: function(e) {
			var t = ka(Fa), n = t.data.get(e);
			return n === void 0 && (n = e(), t.data.set(e, n)), n;
		},
		cacheSignal: function() {
			return ka(Fa).controller.signal;
		}
	}, sd = typeof WeakMap == "function" ? WeakMap : Map, cd = 0, ld = null, ud = null, dd = 0, fd = 0, pd = null, md = !1, hd = !1, gd = !1, _d = 0, vd = 0, yd = 0, bd = 0, xd = 0, Sd = 0, Cd = 0, wd = null, Td = null, Ed = !1, Dd = 0, Od = 0, kd = Infinity, Ad = null, jd = null, Md = 0, Nd = null, Pd = null, Fd = 0, Id = 0, Ld = null, Rd = null, zd = null, Bd = null, Vd = null, Hd = 0, Ud = null;
	function Wd() {
		return cd & 2 && dd !== 0 ? dd & -dd : k.T === null ? Ot() : Jf();
	}
	function Gd() {
		if (Sd === 0) {
			if (!(dd & 536870912) || I) {
				var e = ft;
				ft <<= 1, !(ft & 3932160) && (ft = 262144), Sd = e;
			} else Sd = 536870912;
		}
		return e = Fo.current, e !== null && (e.flags |= 32), Sd;
	}
	function Kd(e, t) {
		if (t != null) {
			var n = e.stateNode, r = n.ref;
			r === null && (r = n.ref = Yp(wi(e.memoizedProps, n))), Bd === null && (Bd = []), Bd.push(t.bind(null, r));
		}
	}
	function qd(e, t, n) {
		(e === ld && (fd === 2 || fd === 9) || e.cancelPendingCommit !== null) && (ef(e, 0), Zd(e, dd, Sd, !1)), xt(e, n), (!(cd & 2) || e !== ld) && (e === ld && (!(cd & 2) && (bd |= n), vd === 4 && Zd(e, dd, Sd, !1)), Bf(e));
	}
	function Jd(e, t, n) {
		if (cd & 6) throw Error(i(327));
		var r = !n && !(t & 127) && (t & e.expiredLanes) === 0 || gt(e, t), a = r ? lf(e, t) : sf(e, t, !0), o = r;
		do {
			if (a === 0) {
				hd && !r && Zd(e, t, 0, !1);
				break;
			}
			if (n = e.current.alternate, o && !Xd(n)) {
				a = sf(e, t, !1), o = !1;
				continue;
			}
			if (a === 2) {
				if (o = t, e.errorRecoveryDisabledLanes & o) var s = 0;
				else s = e.pendingLanes & -536870913, s = s === 0 ? s & 536870912 ? 536870912 : 0 : s;
				if (s !== 0) {
					t = s;
					a: {
						var c = e;
						a = wd;
						var l = c.current.memoizedState.isDehydrated;
						if (l && (ef(c, s).flags |= 256), s = sf(c, s, !1), s !== 2 && s !== 6) {
							if (gd && !l) {
								c.errorRecoveryDisabledLanes |= o, bd |= o, a = 4;
								break a;
							}
							o = Td, Td = a, o !== null && (Td === null ? Td = o : Td.push.apply(Td, o));
						}
						a = s;
					}
					if (o = !1, a !== 2) continue;
				}
			}
			if (a === 1) {
				ef(e, 0), Zd(e, t, 0, !0);
				break;
			}
			a: {
				switch (r = e, o = a, o) {
					case 0:
					case 1: throw Error(i(345));
					case 4: if ((t & 4194048) !== t && (t & 62914560) !== t) break;
					case 6:
						Zd(r, t, Sd, !md);
						break a;
					case 2:
						Td = null;
						break;
					case 3:
					case 5: break;
					default: throw Error(i(329));
				}
				if ((t & 62914560) === t && (a = Dd + 300 - Ye(), 10 < a)) {
					if (Zd(r, t, Sd, !md), ht(r, 0, !0) !== 0) break a;
					Fd = t, r.timeoutHandle = jp(Yd.bind(null, r, n, Td, Ad, Ed, t, Sd, bd, Cd, md, o, "Throttled", -0, 0), a);
					break a;
				}
				Yd(r, n, Td, Ad, Ed, t, Sd, bd, Cd, md, o, null, -0, 0);
			}
			break;
		} while (1);
		Bf(e);
	}
	function Yd(e, t, n, r, i, a, o, s, c, l, u, d, f, p) {
		e.timeoutHandle = -1;
		var m = t.subtreeFlags, h = (a & 335544064) === a;
		if (d = null, (h || m & 8192 || (m & 16785408) == 16785408) && (d = {
			stylesheets: null,
			count: 0,
			imgCount: 0,
			imgBytes: 0,
			suspenseyImages: [],
			waitingForImages: !0,
			waitingForViewTransition: !1,
			unsuspend: Dn
		}, ql = null, ed(t, a, d), h && (m = d, h = e.containerInfo, h = (h.nodeType === 9 ? h : h.ownerDocument).__reactViewTransition, h != null && (m.count++, m.waitingForViewTransition = !0, m = hh.bind(m), h.finished.then(m, m))), m = (a & 62914560) === a ? Dd - Ye() : (a & 4194048) === a ? Od - Ye() : 0, m = ph(d, m), m !== null)) {
			Fd = a, e.cancelPendingCommit = m(gf.bind(null, e, t, a, n, r, i, o, s, c, l, u, d, null, f, p)), Zd(e, a, o, !l);
			return;
		}
		gf(e, t, a, n, r, i, o, s, c, l, u, d);
	}
	function Xd(e) {
		for (var t = e;;) {
			var n = t.tag;
			if ((n === 0 || n === 11 || n === 15) && t.flags & 16384 && (n = t.updateQueue, n !== null && (n = n.stores, n !== null))) for (var r = 0; r < n.length; r++) {
				var i = n[r], a = i.getSnapshot;
				i = i.value;
				try {
					if (!Jr(a(), i)) return !1;
				} catch {
					return !1;
				}
			}
			if (n = t.child, t.subtreeFlags & 16384 && n !== null) n.return = t, t = n;
			else {
				if (t === e) break;
				for (; t.sibling === null;) {
					if (t.return === null || t.return === e) return !0;
					t = t.return;
				}
				t.sibling.return = t.return, t = t.sibling;
			}
		}
		return !0;
	}
	function Zd(e, t, n, r) {
		t = _t(e, t), t &= ~xd, t &= ~bd, e.suspendedLanes |= t, e.pingedLanes &= ~t, r && (e.warmLanes |= t), r = e.expirationTimes;
		for (var i = t; 0 < i;) {
			var a = 31 - st(i), o = 1 << a;
			r[a] = -1, i &= ~o;
		}
		n !== 0 && Ct(e, n, t);
	}
	function Qd() {
		return cd & 6 ? !0 : (Vf(0, !1), !1);
	}
	function $d() {
		if (ud !== null) {
			if (fd === 0) var e = ud.return;
			else e = ud, xa = ba = null, us(e), lo = null, uo = 0, e = ud;
			for (; e !== null;) Dl(e.alternate, e), e = e.return;
			ud = null;
		}
	}
	function ef(e, t) {
		var n = e.timeoutHandle;
		return n !== -1 && (e.timeoutHandle = -1, Mp(n)), n = e.cancelPendingCommit, n !== null && (e.cancelPendingCommit = null, n()), Fd = 0, $d(), ld = e, ud = n = Vi(e.current, null), dd = t, fd = 0, pd = null, md = !1, hd = gt(e, t), gd = !1, Cd = Sd = xd = bd = yd = vd = 0, Td = wd = null, Ed = !1, _d = _t(e, t), ji(), n;
	}
	function tf(e, t) {
		L = null, k.H = bc, t === $a || t === to ? (t = so(), fd = 3) : t === eo ? (t = so(), fd = 4) : fd = t === Rc ? 8 : typeof t == "object" && t && typeof t.then == "function" ? 6 : 1, pd = t, ud === null && (vd = 1, Mc(e, N(t, e.current)));
	}
	function nf() {
		var e = Fo.current;
		return e === null ? !0 : (dd & 4194048) === dd ? Io === null : (dd & 62914560) === dd || dd & 536870912 ? e === Io : !1;
	}
	function rf() {
		var e = k.H;
		return k.H = bc, e === null ? bc : e;
	}
	function af() {
		var e = k.A;
		return k.A = od, e;
	}
	function of() {
		vd = 4, md || (dd & 4194048) !== dd && Fo.current !== null || (hd = !0), !(yd & 134217727) && !(bd & 134217727) || ld === null || Zd(ld, dd, Sd, !1);
	}
	function sf(e, t, n) {
		var r = cd;
		cd |= 2;
		var i = rf(), a = af();
		(ld !== e || dd !== t) && (Ad = null, ef(e, t)), t = !1;
		var o = vd;
		a: do
			try {
				if (fd !== 0 && ud !== null) {
					var s = ud, c = pd;
					switch (fd) {
						case 8:
							$d(), o = 6;
							break a;
						case 3:
						case 2:
						case 9:
						case 6:
							Fo.current === null && (t = !0);
							var l = fd;
							if (fd = 0, pd = null, pf(e, s, c, l), n && hd) {
								o = 0;
								break a;
							}
							break;
						default: l = fd, fd = 0, pd = null, pf(e, s, c, l);
					}
				}
				cf(), o = vd;
				break;
			} catch (t) {
				tf(e, t);
			}
		while (1);
		return t && e.shellSuspendCounter++, xa = ba = null, cd = r, k.H = i, k.A = a, ud === null && (ld = null, dd = 0, ji()), o;
	}
	function cf() {
		for (; ud !== null;) df(ud);
	}
	function lf(e, t) {
		var n = cd;
		cd |= 2;
		var r = rf(), a = af();
		ld !== e || dd !== t ? (Ad = null, kd = Ye() + 500, ef(e, t)) : hd = gt(e, t);
		a: do
			try {
				if (fd !== 0 && ud !== null) {
					t = ud;
					var o = pd;
					b: switch (fd) {
						case 1:
							fd = 0, pd = null, pf(e, t, o, 1);
							break;
						case 2:
						case 9:
							if (ro(o)) {
								fd = 0, pd = null, ff(t);
								break;
							}
							t = function() {
								fd !== 2 && fd !== 9 || ld !== e || (fd = 7), Bf(e);
							}, o.then(t, t);
							break a;
						case 3:
							fd = 7;
							break a;
						case 4:
							fd = 5;
							break a;
						case 7:
							ro(o) ? (fd = 0, pd = null, ff(t)) : (fd = 0, pd = null, pf(e, t, o, 7));
							break;
						case 5:
							var s = null;
							switch (ud.tag) {
								case 26: s = ud.memoizedState;
								case 5:
								case 27:
									var c = ud;
									if (s ? ch(s) : c.stateNode.complete) {
										fd = 0, pd = null;
										var l = c.sibling;
										if (l !== null) ud = l;
										else {
											var u = c.return;
											u === null ? ud = null : (ud = u, mf(u));
										}
										break b;
									}
							}
							fd = 0, pd = null, pf(e, t, o, 5);
							break;
						case 6:
							fd = 0, pd = null, pf(e, t, o, 6);
							break;
						case 8:
							$d(), vd = 6;
							break a;
						default: throw Error(i(462));
					}
				}
				uf();
				break;
			} catch (t) {
				tf(e, t);
			}
		while (1);
		return xa = ba = null, k.H = r, k.A = a, cd = n, ud === null ? (ld = null, dd = 0, ji(), vd) : 0;
	}
	function uf() {
		for (; ud !== null && !qe();) df(ud);
	}
	function df(e) {
		var t = vl(e.alternate, e, _d);
		e.memoizedProps = e.pendingProps, t === null ? mf(e) : ud = t;
	}
	function ff(e) {
		var t = e, n = t.alternate;
		switch (t.tag) {
			case 15:
			case 0:
				t = Qc(n, t, t.pendingProps, t.type, void 0, dd);
				break;
			case 11:
				t = Qc(n, t, t.pendingProps, t.type.render, t.ref, dd);
				break;
			case 5:
				us(t);
				var r = t;
				r === sa && (I ? (ma(r), r.tag === 5 && r.stateNode != null && (ca = r.stateNode)) : (ma(r), I = !0));
			default: Dl(n, t), t = ud = Hi(t, _d), t = vl(n, t, _d);
		}
		e.memoizedProps = e.pendingProps, t === null ? mf(e) : ud = t;
	}
	function pf(e, t, n, r) {
		xa = ba = null, us(t), lo = null, uo = 0;
		var i = t.return;
		try {
			if (Lc(e, i, t, n, dd)) {
				vd = 1, Mc(e, N(n, e.current)), ud = null;
				return;
			}
		} catch (t) {
			if (i !== null) throw ud = i, t;
			vd = 1, Mc(e, N(n, e.current)), ud = null;
			return;
		}
		t.flags & 32768 ? (I || r === 1 ? e = !0 : hd || dd & 536870912 ? e = !1 : (md = e = !0, (r === 2 || r === 9 || r === 3 || r === 6) && (r = Fo.current, r !== null && r.tag === 13 && (r.flags |= 16384))), hf(t, e)) : mf(t);
	}
	function mf(e) {
		var t = e;
		do {
			if (t.flags & 32768) {
				hf(t, md);
				return;
			}
			e = t.return;
			var n = Tl(t.alternate, t, _d);
			if (n !== null) {
				ud = n;
				return;
			}
			if (t = t.sibling, t !== null) {
				ud = t;
				return;
			}
			ud = t = e;
		} while (t !== null);
		vd === 0 && (vd = 5);
	}
	function hf(e, t) {
		do {
			var n = El(e.alternate, e);
			if (n !== null) {
				n.flags &= 32767, ud = n;
				return;
			}
			if (n = e.return, n !== null && (n.flags |= 32768, n.subtreeFlags = 0, n.deletions = null), !t && (e = e.sibling, e !== null)) {
				ud = e;
				return;
			}
			ud = e = n;
		} while (e !== null);
		vd = 6, ud = null;
	}
	function gf(e, t, n, r, a, o, s, c, l, u, d, f) {
		e.cancelPendingCommit = null;
		do
			wf();
		while (Md !== 0);
		if (cd & 6) throw Error(i(327));
		if (t !== null) {
			if (t === e.current) throw Error(i(177));
			e === ld && (ud = ld = null, dd = 0), Pd = t, Nd = e, Fd = n, Ld = a, Rd = r, _f(e, t, n, s, c, l, f);
		}
	}
	function _f(e, t, n, r, i, a, o) {
		var s = t.lanes | t.childLanes;
		if (Id = s, s |= Ai, St(e, n, s, r, i, a), Bd = null, (n & 335544064) === n ? (Vd = Ba(e), r = 10262) : (Vd = null, r = 10256), (t.subtreeFlags & r) !== 0 || (t.flags & r) !== 0 ? (e.callbackNode = null, e.callbackPriority = 0, Nf($e, function() {
			return Tf(), null;
		})) : (e.callbackNode = null, e.callbackPriority = 0), Kl = !1, r = !!(t.flags & 13878), t.subtreeFlags & 13878 || r) {
			r = k.T, k.T = null, i = Se.p, Se.p = 2, a = cd, cd |= 4;
			try {
				xu(e, t, n);
			} finally {
				cd = a, Se.p = i, k.T = r;
			}
		}
		Md = 1, Kl ? zd = qp(o, e.containerInfo, Vd, bf, xf, yf, Sf, Tf, vf, null, null) : (bf(), xf(), Sf());
	}
	function vf(e) {
		if (Md !== 0) {
			var t = Nd.onRecoverableError;
			t(e, { componentStack: null });
		}
	}
	function yf() {
		Md === 3 && (Md = 0, Hu(Pd, Nd), Md = 4);
	}
	function bf() {
		if (Md === 1) {
			Md = 0;
			var e = Nd, t = Pd, n = Fd, r = !!(t.flags & 13878);
			if (t.subtreeFlags & 13878 || r) {
				r = k.T, k.T = null;
				var i = Se.p;
				Se.p = 2;
				var a = cd;
				cd |= 4;
				try {
					vu = yu = !1, Ru(t, e, n), n = Cp;
					var o = ei(e.containerInfo), s = n.focusedElem, c = n.selectionRange;
					if (o !== s && s && s.ownerDocument && $r(s.ownerDocument.documentElement, s)) {
						if (c !== null && ti(s)) {
							var l = c.start, u = c.end;
							if (u === void 0 && (u = l), "selectionStart" in s) s.selectionStart = l, s.selectionEnd = Math.min(u, s.value.length);
							else {
								var d = s.ownerDocument || document, f = d && d.defaultView || window;
								if (f.getSelection) {
									var p = f.getSelection(), m = s.textContent.length, h = Math.min(c.start, m), g = c.end === void 0 ? h : Math.min(c.end, m);
									!p.extend && h > g && (o = g, g = h, h = o);
									var _ = Qr(s, h), v = Qr(s, g);
									if (_ && v && (p.rangeCount !== 1 || p.anchorNode !== _.node || p.anchorOffset !== _.offset || p.focusNode !== v.node || p.focusOffset !== v.offset)) {
										var y = d.createRange();
										y.setStart(_.node, _.offset), p.removeAllRanges(), h > g ? (p.addRange(y), p.extend(v.node, v.offset)) : (y.setEnd(v.node, v.offset), p.addRange(y));
									}
								}
							}
						}
						for (d = [], p = s; p = p.parentNode;) p.nodeType === 1 && d.push({
							element: p,
							left: p.scrollLeft,
							top: p.scrollTop
						});
						for (typeof s.focus == "function" && s.focus(), s = 0; s < d.length; s++) {
							var b = d[s];
							b.element.scrollLeft = b.left, b.element.scrollTop = b.top;
						}
					}
					kh = !!Sp, Cp = Sp = null;
				} finally {
					cd = a, Se.p = i, k.T = r;
				}
			}
			e.current = t, Md = 2;
		}
	}
	function xf() {
		if (Md === 2) {
			Md = 0;
			var e = Nd, t = Pd, n = !!(t.flags & 8772);
			if (t.subtreeFlags & 8772 || n) {
				n = k.T, k.T = null;
				var r = Se.p;
				Se.p = 2;
				var i = cd;
				cd |= 4;
				try {
					Cu(e, t.alternate, t);
				} finally {
					cd = i, Se.p = r, k.T = n;
				}
			}
			Md = 3;
		}
	}
	function Sf() {
		if (Md === 4 || Md === 3) {
			Md = 0;
			var e = zd;
			zd = null, Je();
			var t = Nd, n = Pd, r = Fd, i = Rd, a = (r & 335544064) === r ? 10262 : 10256;
			if ((n.subtreeFlags & a) !== 0 || (n.flags & a) !== 0 ? Md = 5 : (Md = 0, Pd = Nd = null, Cf(t, t.pendingLanes)), a = t.pendingLanes, a === 0 && (jd = null), Dt(r), n = n.stateNode, at && typeof at.onCommitFiberRoot == "function") try {
				at.onCommitFiberRoot(it, n, void 0, (n.current.flags & 128) == 128);
			} catch {}
			if (i !== null) {
				n = k.T, a = Se.p, Se.p = 2, k.T = null;
				try {
					for (var o = t.onRecoverableError, s = 0; s < i.length; s++) {
						var c = i[s];
						o(c.value, { componentStack: c.stack });
					}
				} finally {
					k.T = n, Se.p = a;
				}
			}
			if (i = Bd, o = Vd, Vd = null, i !== null && (Bd = null, o === null && (o = []), e !== null)) for (c = 0; c < i.length; c++) n = (0, i[c])(o), n !== void 0 && e.finished.finally(n);
			Fd & 3 && wf(), Bf(t), a = t.pendingLanes, r & 261930 && a & 42 ? t === Ud ? Hd++ : (Hd = 0, Ud = t) : (Hd = 0, Ud = null), Vf(0, !1);
		}
	}
	function Cf(e, t) {
		(e.pooledCacheLanes &= t) === 0 && (t = e.pooledCache, t != null && (e.pooledCache = null, La(t)));
	}
	function wf() {
		return zd !== null && (zd.skipTransition(), zd = null), bf(), xf(), Sf(), Tf();
	}
	function Tf() {
		if (Md !== 5) return !1;
		var e = Nd, t = Id;
		Id = 0;
		var n = Dt(Fd), r = k.T, a = Se.p;
		try {
			Se.p = 32 > n ? 32 : n, k.T = null, n = Ld, Ld = null;
			var o = Nd, s = Fd;
			if (Md = 0, Pd = Nd = null, Fd = 0, cd & 6) throw Error(i(331));
			var c = cd;
			if (cd |= 4, rd(o.current), Yu(o, o.current, s, n), cd = c, Vf(0, !1), at && typeof at.onPostCommitFiberRoot == "function") try {
				at.onPostCommitFiberRoot(it, o);
			} catch {}
			return !0;
		} finally {
			Se.p = a, k.T = r, Cf(e, t);
		}
	}
	function Ef(e, t, n) {
		t = N(n, t), t = Pc(e.stateNode, t, 2), e = So(e, t, 2), e !== null && (xt(e, 2), Bf(e));
	}
	function Df(e, t, n) {
		if (e.tag === 3) Ef(e, e, n);
		else for (; t !== null;) {
			if (t.tag === 3) {
				Ef(t, e, n);
				break;
			}
			if (t.tag === 1) {
				var r = t.stateNode;
				if (typeof t.type.getDerivedStateFromError == "function" || typeof r.componentDidCatch == "function" && (jd === null || !jd.has(r))) {
					e = N(n, e), n = Fc(2), r = So(t, n, 2), r !== null && (Ic(n, r, t, e), xt(r, 2), Bf(r));
					break;
				}
			}
			t = t.return;
		}
	}
	function Of(e, t, n) {
		var r = e.pingCache;
		if (r === null) {
			r = e.pingCache = new sd();
			var i = /* @__PURE__ */ new Set();
			r.set(t, i);
		} else i = r.get(t), i === void 0 && (i = /* @__PURE__ */ new Set(), r.set(t, i));
		i.has(n) || (gd = !0, i.add(n), e = kf.bind(null, e, t, n), t.then(e, e));
	}
	function kf(e, t, n) {
		var r = e.pingCache;
		r !== null && r.delete(t), e.pingedLanes |= e.suspendedLanes & n, e.warmLanes &= ~n, ld === e && (dd & n) === n && (vd === 4 || vd === 3 && (dd & 62914560) === dd && 300 > Ye() - Dd ? cd & 2 ? xd |= n : ef(e, 0) : xd |= n, Cd === dd && (Cd = 0)), Bf(e);
	}
	function Af(e, t) {
		t === 0 && (t = yt()), e = Pi(e, t), e !== null && (xt(e, t), Bf(e));
	}
	function jf(e) {
		var t = e.memoizedState, n = 0;
		t !== null && (n = t.retryLane), Af(e, n);
	}
	function Mf(e, t) {
		var n = 0;
		switch (e.tag) {
			case 31:
			case 13:
				var r = e.stateNode, a = e.memoizedState;
				a !== null && (n = a.retryLane);
				break;
			case 19:
				r = e.stateNode;
				break;
			case 22:
				r = e.stateNode._retryCache;
				break;
			default: throw Error(i(314));
		}
		r !== null && r.delete(t), Af(e, n);
	}
	function Nf(e, t) {
		return Ge(e, t);
	}
	var Pf = null, Ff = null, If = !1, Lf = !1, Rf = !1, zf = 0;
	function Bf(e) {
		e !== Ff && e.next === null && (Ff === null ? Pf = Ff = e : Ff = Ff.next = e), Lf = !0, If || (If = !0, qf());
	}
	function Vf(e, t) {
		if (!Rf && Lf) {
			Rf = !0;
			do
				for (var n = !1, r = Pf; r !== null;) {
					if (!t) {
						if (e !== 0) {
							var i = r.pendingLanes;
							if (i === 0) var a = 0;
							else {
								var o = r.suspendedLanes, s = r.pingedLanes;
								a = (1 << 31 - st(42 | e) + 1) - 1, a &= i & ~(o & ~s), a = a & 201326741 ? a & 201326741 | 1 : a ? a | 2 : 0;
							}
							a !== 0 && (n = !0, Kf(r, a));
						} else a = dd, a = ht(r, r === ld ? a : 0, r.cancelPendingCommit !== null || r.timeoutHandle !== -1), !(a & 3) || gt(r, a) || (n = !0, Kf(r, a));
					}
					r = r.next;
				}
			while (n);
			Rf = !1;
		}
	}
	function Hf() {
		Uf();
	}
	function Uf() {
		Lf = If = !1;
		var e = 0;
		zf !== 0 && Ap() && (e = zf);
		for (var t = Ye(), n = null, r = Pf; r !== null;) {
			var i = r.next, a = Wf(r, t);
			a === 0 ? (r.next = null, n === null ? Pf = i : n.next = i, i === null && (Ff = n)) : (n = r, (e !== 0 || a & 3) && (Lf = !0)), r = i;
		}
		Md !== 0 && Md !== 5 || Vf(e, !1), zf !== 0 && (zf = 0);
	}
	function Wf(e, t) {
		for (var n = e.suspendedLanes, r = e.pingedLanes, i = e.expirationTimes, a = e.pendingLanes & -62914561; 0 < a;) {
			var o = 31 - st(a), s = 1 << o, c = i[o];
			c === -1 ? ((s & n) === 0 || (s & r) !== 0) && (i[o] = vt(s, t)) : c <= t && (e.expiredLanes |= s), a &= ~s;
		}
		if (t = ld, n = dd, n = ht(e, e === t ? n : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r = e.callbackNode, n === 0 || e === t && (fd === 2 || fd === 9) || e.cancelPendingCommit !== null) return r !== null && r !== null && Ke(r), e.callbackNode = null, e.callbackPriority = 0;
		if (!(n & 3) || gt(e, n)) {
			if (t = n & -n, t === e.callbackPriority) return t;
			switch (r !== null && Ke(r), Dt(n)) {
				case 2:
				case 8:
					n = Qe;
					break;
				case 32:
					n = $e;
					break;
				case 268435456:
					n = tt;
					break;
				default: n = $e;
			}
			return r = Gf.bind(null, e), n = Ge(n, r), e.callbackPriority = t, e.callbackNode = n, t;
		}
		return r !== null && r !== null && Ke(r), e.callbackPriority = 2, e.callbackNode = null, 2;
	}
	function Gf(e, t) {
		if (Md !== 0 && Md !== 5) return e.callbackNode = null, e.callbackPriority = 0, null;
		var n = e.callbackNode;
		if (wf() && e.callbackNode !== n) return null;
		var r = dd;
		return r = ht(e, e === ld ? r : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r === 0 ? null : (Jd(e, r, t), Wf(e, Ye()), e.callbackNode != null && e.callbackNode === n ? Gf.bind(null, e) : null);
	}
	function Kf(e, t) {
		if (wf()) return null;
		Jd(e, t, !0);
	}
	function qf() {
		Fp(function() {
			cd & 6 ? Ge(Ze, Hf) : Uf();
		});
	}
	function Jf() {
		if (zf === 0) {
			var e = Ua;
			e === 0 && (e = dt, dt <<= 1, !(dt & 261888) && (dt = 256)), zf = e;
		}
		return zf;
	}
	function Yf(e) {
		return e == null || typeof e == "symbol" || typeof e == "boolean" ? null : typeof e == "function" ? e : En(e);
	}
	function Xf(e, t, n, r, i) {
		if (t === "submit" && n && n.stateNode === i) {
			var a = Yf((i[Mt] || null).action), o = r.submitter;
			o && (t = (t = o[Mt] || null) ? Yf(t.formAction) : o.getAttribute("formAction"), t !== null && (a = t, o = null));
			var s = new M("action", "action", null, r, i);
			e.push({
				event: s,
				listeners: [{
					instance: null,
					listener: function() {
						if (r.defaultPrevented) {
							if (zf !== 0) {
								var e = new FormData(i, o);
								oc(n, {
									pending: !0,
									data: e,
									method: i.method,
									action: a
								}, null, e);
							}
						} else typeof a == "function" && (s.preventDefault(), e = new FormData(i, o), oc(n, {
							pending: !0,
							data: e,
							method: i.method,
							action: a
						}, a, e));
					},
					currentTarget: i
				}]
			});
		}
	}
	for (var Zf = 0; Zf < xi.length; Zf++) {
		var Qf = xi[Zf];
		Si(Qf.toLowerCase(), "on" + (Qf[0].toUpperCase() + Qf.slice(1)));
	}
	Si(pi, "onAnimationEnd"), Si(mi, "onAnimationIteration"), Si(hi, "onAnimationStart"), Si("dblclick", "onDoubleClick"), Si("focusin", "onFocus"), Si("focusout", "onBlur"), Si(gi, "onTransitionRun"), Si(_i, "onTransitionStart"), Si(vi, "onTransitionCancel"), Si(yi, "onTransitionEnd"), Xt("onMouseEnter", ["mouseout", "mouseover"]), Xt("onMouseLeave", ["mouseout", "mouseover"]), Xt("onPointerEnter", ["pointerout", "pointerover"]), Xt("onPointerLeave", ["pointerout", "pointerover"]), Yt("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" ")), Yt("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")), Yt("onBeforeInput", [
		"compositionend",
		"keypress",
		"textInput",
		"paste"
	]), Yt("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" ")), Yt("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" ")), Yt("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
	var $f = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "), ep = new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat($f));
	function tp(e, t) {
		t = !!(t & 4);
		for (var n = 0; n < e.length; n++) {
			var r = e[n], i = r.event;
			r = r.listeners;
			a: {
				var a = void 0;
				if (t) for (var o = r.length - 1; 0 <= o; o--) {
					var s = r[o], c = s.instance, l = s.currentTarget;
					if (s = s.listener, c !== a && i.isPropagationStopped()) break a;
					a = s, i.currentTarget = l;
					try {
						a(i);
					} catch (e) {
						Di(e);
					}
					i.currentTarget = null, a = c;
				}
				else for (o = 0; o < r.length; o++) {
					if (s = r[o], c = s.instance, l = s.currentTarget, s = s.listener, c !== a && i.isPropagationStopped()) break a;
					a = s, i.currentTarget = l;
					try {
						a(i);
					} catch (e) {
						Di(e);
					}
					i.currentTarget = null, a = c;
				}
			}
		}
	}
	function R(e, t) {
		var n = t[Pt];
		n === void 0 && (n = t[Pt] = /* @__PURE__ */ new Set());
		var r = e + "__bubble";
		n.has(r) || (ap(t, e, 2, !1), n.add(r));
	}
	function np(e, t, n) {
		var r = 0;
		t && (r |= 4), ap(n, e, r, t);
	}
	var rp = "_reactListening" + Math.random().toString(36).slice(2);
	function ip(e) {
		if (!e[rp]) {
			e[rp] = !0, qt.forEach(function(t) {
				t !== "selectionchange" && (ep.has(t) || np(t, !1, e), np(t, !0, e));
			});
			var t = e.nodeType === 9 ? e : e.ownerDocument;
			t === null || t[rp] || (t[rp] = !0, np("selectionchange", !1, t));
		}
	}
	function ap(e, t, n, r) {
		switch (Ih(t)) {
			case 2:
				var i = Ah;
				break;
			case 8:
				i = jh;
				break;
			default: i = Mh;
		}
		n = i.bind(null, t, n, e), i = void 0, !j || t !== "touchstart" && t !== "touchmove" && t !== "wheel" || (i = !0), r ? i === void 0 ? e.addEventListener(t, n, !0) : e.addEventListener(t, n, {
			capture: !0,
			passive: i
		}) : i === void 0 ? e.addEventListener(t, n, !1) : e.addEventListener(t, n, { passive: i });
	}
	function op(e, t, n, r, i) {
		var a = r;
		if (!(t & 1) && !(t & 2) && r !== null) a: for (;;) {
			if (r === null) return;
			var s = r.tag;
			if (s === 3 || s === 4) {
				var c = r.stateNode.containerInfo;
				if (c === i) break;
				if (s === 4) for (s = r.return; s !== null;) {
					var l = s.tag;
					if ((l === 3 || l === 4) && s.stateNode.containerInfo === i) return;
					s = s.return;
				}
				for (; c !== null;) {
					if (s = Vt(c), s === null) return;
					if (l = s.tag, l === 5 || l === 6 || l === 26 || l === 27) {
						r = a = s;
						continue a;
					}
					c = c.parentNode;
				}
			}
			r = r.return;
		}
		Pn(function() {
			var r = a, i = kn(n), s = [];
			a: {
				var c = bi.get(e);
				if (c !== void 0) {
					var l = M, u = e;
					switch (e) {
						case "keypress": if (Hn(n) === 0) break a;
						case "keydown":
						case "keyup":
							l = ur;
							break;
						case "focusin":
							u = "focus", l = tr;
							break;
						case "focusout":
							u = "blur", l = tr;
							break;
						case "beforeblur":
						case "afterblur":
							l = tr;
							break;
						case "click": if (n.button === 2) break a;
						case "auxclick":
						case "dblclick":
						case "mousedown":
						case "mousemove":
						case "mouseup":
						case "mouseout":
						case "mouseover":
						case "contextmenu":
							l = $n;
							break;
						case "drag":
						case "dragend":
						case "dragenter":
						case "dragexit":
						case "dragleave":
						case "dragover":
						case "dragstart":
						case "drop":
							l = er;
							break;
						case "touchcancel":
						case "touchend":
						case "touchmove":
						case "touchstart":
							l = pr;
							break;
						case pi:
						case mi:
						case hi:
							l = nr;
							break;
						case yi:
							l = mr;
							break;
						case "scroll":
						case "scrollend":
							l = Jn;
							break;
						case "wheel":
							l = hr;
							break;
						case "copy":
						case "cut":
						case "paste":
							l = rr;
							break;
						case "gotpointercapture":
						case "lostpointercapture":
						case "pointercancel":
						case "pointerdown":
						case "pointermove":
						case "pointerout":
						case "pointerover":
						case "pointerup":
							l = dr;
							break;
						case "submit":
							l = fr;
							break;
						case "toggle":
						case "beforetoggle": l = gr;
					}
					var d = !!(t & 4), f = !d && (e === "scroll" || e === "scrollend"), p = d ? c === null ? null : c + "Capture" : c;
					d = [];
					for (var m = r, h; m !== null;) {
						var g = m;
						if (h = g.stateNode, g = g.tag, g !== 5 && g !== 26 && g !== 27 || h === null || p === null || (g = Fn(m, p), g != null && d.push(sp(m, g, h))), f) break;
						m = m.return;
					}
					0 < d.length && (c = new l(c, u, null, n, i), s.push({
						event: c,
						listeners: d
					}));
				}
			}
			if (!(t & 7)) {
				a: {
					if (l = e === "mouseover" || e === "pointerover", c = e === "mouseout" || e === "pointerout", l && n !== On && (u = n.relatedTarget || n.fromElement) && (Vt(u) || u[Nt])) break a;
					(c || l) && (u = i.window === i ? i : (l = i.ownerDocument) ? l.defaultView || l.parentWindow : window, c ? (l = n.relatedTarget || n.toElement, c = r, l = l ? Vt(l) : null, l !== null && (f = o(l), d = l.tag, l !== f || d !== 5 && d !== 27 && d !== 6) && (l = null)) : (c = null, l = r), c !== l && (d = $n, g = "onMouseLeave", p = "onMouseEnter", m = "mouse", (e === "pointerout" || e === "pointerover") && (d = dr, g = "onPointerLeave", p = "onPointerEnter", m = "pointer"), f = c == null ? u : Ut(c), h = l == null ? u : Ut(l), u = new d(g, m + "leave", c, n, i), u.target = f, u.relatedTarget = h, g = null, Vt(i) === r && (d = new d(p, m + "enter", l, n, i), d.target = h, d.relatedTarget = f, g = d), f = g, d = c && l ? ee(c, l, lp) : null, c !== null && up(s, u, c, d, !1), l !== null && f !== null && up(s, f, l, d, !0)));
				}
				a: {
					if (c = r ? Ut(r) : window, l = c.nodeName && c.nodeName.toLowerCase(), l === "select" || l === "input" && c.type === "file") var _ = Ir;
					else if (Ar(c)) {
						if (Lr) _ = Kr;
						else {
							_ = Wr;
							var v = Ur;
						}
					} else l = c.nodeName, !l || l.toLowerCase() !== "input" || c.type !== "checkbox" && c.type !== "radio" ? r && Cn(r.elementType) && (_ = Ir) : _ = Gr;
					if (_ &&= _(e, r)) {
						jr(s, _, n, i);
						break a;
					}
					v && v(e, c, r);
				}
				switch (v = r ? Ut(r) : window, e) {
					case "focusin":
						(Ar(v) || v.contentEditable === "true") && (ri = v, ii = r, ai = null);
						break;
					case "focusout":
						ai = ii = ri = null;
						break;
					case "mousedown":
						oi = !0;
						break;
					case "contextmenu":
					case "mouseup":
					case "dragend":
						oi = !1, si(s, n, i);
						break;
					case "selectionchange": if (ni) break;
					case "keydown":
					case "keyup": si(s, n, i);
				}
				var y;
				if (vr) b: {
					switch (e) {
						case "compositionstart":
							var b = "onCompositionStart";
							break b;
						case "compositionend":
							b = "onCompositionEnd";
							break b;
						case "compositionupdate":
							b = "onCompositionUpdate";
							break b;
					}
					b = void 0;
				}
				else Er ? wr(e, n) && (b = "onCompositionEnd") : e === "keydown" && n.keyCode === 229 && (b = "onCompositionStart");
				b && (xr && n.locale !== "ko" && (Er || b !== "onCompositionStart" ? b === "onCompositionEnd" && Er && (y = Vn()) : (Rn = i, zn = "value" in Rn ? Rn.value : Rn.textContent, Er = !0)), v = cp(r, b), 0 < v.length && (b = new ir(b, e, null, n, i), s.push({
					event: b,
					listeners: v
				}), y ? b.data = y : (y = Tr(n), y !== null && (b.data = y)))), (y = br ? Dr(e, n) : Or(e, n)) && (b = cp(r, "onBeforeInput"), 0 < b.length && (v = new ir("onBeforeInput", "beforeinput", null, n, i), s.push({
					event: v,
					listeners: b
				}), v.data = y)), Xf(s, e, r, n, i);
			}
			tp(s, t);
		});
	}
	function sp(e, t, n) {
		return {
			instance: e,
			listener: t,
			currentTarget: n
		};
	}
	function cp(e, t) {
		for (var n = t + "Capture", r = []; e !== null;) {
			var i = e, a = i.stateNode;
			if (i = i.tag, i !== 5 && i !== 26 && i !== 27 || a === null || (i = Fn(e, n), i != null && r.unshift(sp(e, i, a)), i = Fn(e, t), i != null && r.push(sp(e, i, a))), e.tag === 3) return r;
			e = e.return;
		}
		return [];
	}
	function lp(e) {
		if (e === null) return null;
		do
			e = e.return;
		while (e && e.tag !== 5 && e.tag !== 27);
		return e || null;
	}
	function up(e, t, n, r, i) {
		for (var a = t._reactName, o = []; n !== null && n !== r;) {
			var s = n, c = s.alternate, l = s.stateNode;
			if (s = s.tag, c !== null && c === r) break;
			s !== 5 && s !== 26 && s !== 27 || l === null || (c = l, i ? (l = Fn(n, a), l != null && o.unshift(sp(n, l, c))) : i || (l = Fn(n, a), l != null && o.push(sp(n, l, c)))), n = n.return;
		}
		o.length !== 0 && e.push({
			event: t,
			listeners: o
		});
	}
	var dp = /\r\n?/g, fp = /\u0000|\uFFFD/g;
	function pp(e) {
		return (typeof e == "string" ? e : "" + e).replace(dp, "\n").replace(fp, "");
	}
	function mp(e, t) {
		return t = pp(t), pp(e) === t;
	}
	function hp(e, t, n, r, a, o) {
		switch (n) {
			case "children":
				if (typeof r == "string") t === "body" || t === "textarea" && r === "" || yn(e, r);
				else if (typeof r == "number" || typeof r == "bigint") t !== "body" && yn(e, "" + r);
				else return;
				break;
			case "className":
				an(e, "class", r);
				break;
			case "tabIndex":
				an(e, "tabindex", r);
				break;
			case "dir":
			case "role":
			case "viewBox":
			case "width":
			case "height":
				an(e, n, r);
				break;
			case "style":
				Sn(e, r, o);
				return;
			case "data": if (t !== "object") {
				an(e, "data", r);
				break;
			}
			case "src":
			case "href":
				if (r === "" && (t !== "a" || n !== "href")) {
					e.removeAttribute(n);
					break;
				}
				if (r == null || typeof r == "function" || typeof r == "symbol" || typeof r == "boolean") {
					e.removeAttribute(n);
					break;
				}
				r = En(r), e.setAttribute(n, r);
				break;
			case "action":
			case "formAction":
				if (typeof r == "function") {
					e.setAttribute(n, "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");
					break;
				}
				if (typeof o == "function" && (n === "formAction" ? (t !== "input" && hp(e, t, "name", a.name, a, null), hp(e, t, "formEncType", a.formEncType, a, null), hp(e, t, "formMethod", a.formMethod, a, null), hp(e, t, "formTarget", a.formTarget, a, null)) : (hp(e, t, "encType", a.encType, a, null), hp(e, t, "method", a.method, a, null), hp(e, t, "target", a.target, a, null))), r == null || typeof r == "symbol" || typeof r == "boolean") {
					e.removeAttribute(n);
					break;
				}
				r = En(r), e.setAttribute(n, r);
				break;
			case "onClick":
				r != null && (e.onclick = Dn);
				return;
			case "onScroll":
				r != null && R("scroll", e);
				return;
			case "onScrollEnd":
				r != null && R("scrollend", e);
				return;
			case "dangerouslySetInnerHTML":
				if (r != null) {
					if (typeof r != "object" || !("__html" in r)) throw Error(i(61));
					if (n = r.__html, n != null) {
						if (a.children != null) throw Error(i(60));
						o?.__html !== n && (e.innerHTML = n);
					}
				}
				break;
			case "multiple":
				e.multiple = r && typeof r != "function" && typeof r != "symbol";
				break;
			case "muted":
				e.muted = r && typeof r != "function" && typeof r != "symbol";
				break;
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "defaultValue":
			case "defaultChecked":
			case "innerHTML":
			case "ref": break;
			case "autoFocus": break;
			case "xlinkHref":
				if (r == null || typeof r == "function" || typeof r == "boolean" || typeof r == "symbol") {
					e.removeAttribute("xlink:href");
					break;
				}
				n = En(r), e.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", n);
				break;
			case "contentEditable":
			case "spellCheck":
			case "draggable":
			case "value":
			case "autoReverse":
			case "externalResourcesRequired":
			case "focusable":
			case "preserveAlpha":
				r != null && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, r) : e.removeAttribute(n);
				break;
			case "inert":
			case "allowFullScreen":
			case "async":
			case "autoPlay":
			case "controls":
			case "credentialless":
			case "default":
			case "defer":
			case "disabled":
			case "disablePictureInPicture":
			case "disableRemotePlayback":
			case "formNoValidate":
			case "hidden":
			case "loop":
			case "noModule":
			case "noValidate":
			case "open":
			case "playsInline":
			case "readOnly":
			case "required":
			case "reversed":
			case "scoped":
			case "seamless":
			case "itemScope":
				r && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, "") : e.removeAttribute(n);
				break;
			case "capture":
			case "download":
				!0 === r ? e.setAttribute(n, "") : !1 !== r && r != null && typeof r != "function" && typeof r != "symbol" ? e.setAttribute(n, r) : e.removeAttribute(n);
				break;
			case "cols":
			case "rows":
			case "size":
			case "span":
				r != null && typeof r != "function" && typeof r != "symbol" && !isNaN(r) && 1 <= r ? e.setAttribute(n, r) : e.removeAttribute(n);
				break;
			case "rowSpan":
			case "start":
				r == null || typeof r == "function" || typeof r == "symbol" || isNaN(r) ? e.removeAttribute(n) : e.setAttribute(n, r);
				break;
			case "popover":
				R("beforetoggle", e), R("toggle", e), rn(e, "popover", r);
				break;
			case "xlinkActuate":
				on(e, "http://www.w3.org/1999/xlink", "xlink:actuate", r);
				break;
			case "xlinkArcrole":
				on(e, "http://www.w3.org/1999/xlink", "xlink:arcrole", r);
				break;
			case "xlinkRole":
				on(e, "http://www.w3.org/1999/xlink", "xlink:role", r);
				break;
			case "xlinkShow":
				on(e, "http://www.w3.org/1999/xlink", "xlink:show", r);
				break;
			case "xlinkTitle":
				on(e, "http://www.w3.org/1999/xlink", "xlink:title", r);
				break;
			case "xlinkType":
				on(e, "http://www.w3.org/1999/xlink", "xlink:type", r);
				break;
			case "xmlBase":
				on(e, "http://www.w3.org/XML/1998/namespace", "xml:base", r);
				break;
			case "xmlLang":
				on(e, "http://www.w3.org/XML/1998/namespace", "xml:lang", r);
				break;
			case "xmlSpace":
				on(e, "http://www.w3.org/XML/1998/namespace", "xml:space", r);
				break;
			case "is":
				rn(e, "is", r);
				break;
			case "innerText":
			case "textContent": return;
			default: if (!(2 < n.length) || n[0] !== "o" && n[0] !== "O" || n[1] !== "n" && n[1] !== "N") n = wn.get(n) || n, rn(e, n, r);
			else return;
		}
		tn = !0;
	}
	function gp(e, t, n, r, a, o) {
		switch (n) {
			case "style":
				Sn(e, r, o);
				return;
			case "dangerouslySetInnerHTML":
				if (r != null) {
					if (typeof r != "object" || !("__html" in r)) throw Error(i(61));
					if (n = r.__html, n != null) {
						if (a.children != null) throw Error(i(60));
						o?.__html !== n && (e.innerHTML = n);
					}
				}
				break;
			case "children":
				if (typeof r == "string") yn(e, r);
				else if (typeof r == "number" || typeof r == "bigint") yn(e, "" + r);
				else return;
				break;
			case "onScroll":
				r != null && R("scroll", e);
				return;
			case "onScrollEnd":
				r != null && R("scrollend", e);
				return;
			case "onClick":
				r != null && (e.onclick = Dn);
				return;
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "innerHTML":
			case "ref": return;
			case "innerText":
			case "textContent": return;
			default:
				if (!Jt.hasOwnProperty(n)) a: {
					if (n[0] === "o" && n[1] === "n" && (a = n.endsWith("Capture"), o = n.slice(2, a ? n.length - 7 : void 0), t = e[Mt] || null, t = t == null ? null : t[n], typeof t == "function" && e.removeEventListener(o, t, a), typeof r == "function")) {
						typeof t != "function" && t !== null && (n in e ? e[n] = null : e.hasAttribute(n) && e.removeAttribute(n)), e.addEventListener(o, r, a);
						break a;
					}
					tn = !0, n in e ? e[n] = r : !0 === r ? e.setAttribute(n, "") : rn(e, n, r);
				}
				return;
		}
		tn = !0;
	}
	function _p(e, t, n) {
		switch (t) {
			case "div":
			case "span":
			case "svg":
			case "path":
			case "a":
			case "g":
			case "p":
			case "li": break;
			case "img":
				R("error", e), R("load", e);
				var r = !1, a = !1, o;
				for (o in n) if (n.hasOwnProperty(o)) {
					var s = n[o];
					if (s != null) switch (o) {
						case "src":
							r = !0;
							break;
						case "srcSet":
							a = !0;
							break;
						case "children":
						case "dangerouslySetInnerHTML": throw Error(i(137, t));
						default: hp(e, t, o, s, n, null);
					}
				}
				a && hp(e, t, "srcSet", n.srcSet, n, null), r && hp(e, t, "src", n.src, n, null);
				return;
			case "input":
				R("invalid", e);
				var c = o = s = a = null, l = null, u = null;
				for (r in n) if (n.hasOwnProperty(r)) {
					var d = n[r];
					if (d != null) switch (r) {
						case "name":
							a = d;
							break;
						case "type":
							s = d;
							break;
						case "checked":
							l = d;
							break;
						case "defaultChecked":
							u = d;
							break;
						case "value":
							o = d;
							break;
						case "defaultValue":
							c = d;
							break;
						case "children":
						case "dangerouslySetInnerHTML":
							if (d != null) throw Error(i(137, t));
							break;
						default: hp(e, t, r, d, n, null);
					}
				}
				mn(e, o, c, l, u, s, a, !1);
				return;
			case "select":
				for (a in R("invalid", e), r = s = o = null, n) if (n.hasOwnProperty(a) && (c = n[a], c != null)) switch (a) {
					case "value":
						o = c;
						break;
					case "defaultValue":
						s = c;
						break;
					case "multiple": r = c;
					default: hp(e, t, a, c, n, null);
				}
				t = o, n = s, e.multiple = !!r, t == null ? n != null && gn(e, !!r, n, !0) : gn(e, !!r, t, !1);
				return;
			case "textarea":
				for (s in R("invalid", e), o = a = r = null, n) if (n.hasOwnProperty(s) && (c = n[s], c != null)) switch (s) {
					case "value":
						r = c;
						break;
					case "defaultValue":
						a = c;
						break;
					case "children":
						o = c;
						break;
					case "dangerouslySetInnerHTML":
						if (c != null) throw Error(i(91));
						break;
					default: hp(e, t, s, c, n, null);
				}
				vn(e, r, a, o);
				return;
			case "option":
				for (l in n) if (n.hasOwnProperty(l) && (r = n[l], r != null)) switch (l) {
					case "selected":
						e.selected = r && typeof r != "function" && typeof r != "symbol";
						break;
					default: hp(e, t, l, r, n, null);
				}
				return;
			case "dialog":
				R("beforetoggle", e), R("toggle", e), R("cancel", e), R("close", e);
				break;
			case "iframe":
			case "object":
				R("load", e);
				break;
			case "video":
			case "audio":
				for (r = 0; r < $f.length; r++) R($f[r], e);
				break;
			case "image":
				R("error", e), R("load", e);
				break;
			case "details":
				R("toggle", e);
				break;
			case "embed":
			case "source":
			case "link": R("error", e), R("load", e);
			case "area":
			case "base":
			case "br":
			case "col":
			case "hr":
			case "keygen":
			case "meta":
			case "param":
			case "track":
			case "wbr":
			case "menuitem":
				for (u in n) if (n.hasOwnProperty(u) && (r = n[u], r != null)) switch (u) {
					case "children":
					case "dangerouslySetInnerHTML": throw Error(i(137, t));
					default: hp(e, t, u, r, n, null);
				}
				return;
			default: if (Cn(t)) {
				for (d in n) n.hasOwnProperty(d) && (r = n[d], r !== void 0 && gp(e, t, d, r, n, void 0));
				return;
			}
		}
		for (c in n) n.hasOwnProperty(c) && (r = n[c], r != null && hp(e, t, c, r, n, null));
	}
	var vp = {};
	function yp(e, t, n, r) {
		switch (t) {
			case "div":
			case "span":
			case "svg":
			case "path":
			case "a":
			case "g":
			case "p":
			case "li": break;
			case "input":
				var a = null, o = null, s = null, c = null, l = null, u = null, d = null;
				for (m in n) {
					var f = n[m];
					if (n.hasOwnProperty(m) && f != null) switch (m) {
						case "checked": break;
						case "value": break;
						case "defaultValue": l = f;
						default: r.hasOwnProperty(m) || hp(e, t, m, null, r, f);
					}
				}
				for (var p in r) {
					var m = r[p];
					if (f = n[p], r.hasOwnProperty(p) && (m != null || f != null)) switch (p) {
						case "type":
							m !== f && (tn = !0), o = m;
							break;
						case "name":
							m !== f && (tn = !0), a = m;
							break;
						case "checked":
							m !== f && (tn = !0), u = m;
							break;
						case "defaultChecked":
							m !== f && (tn = !0), d = m;
							break;
						case "value":
							m !== f && (tn = !0), s = m;
							break;
						case "defaultValue":
							m !== f && (tn = !0), c = m;
							break;
						case "children":
						case "dangerouslySetInnerHTML":
							if (m != null) throw Error(i(137, t));
							break;
						default: m !== f && hp(e, t, p, m, r, f);
					}
				}
				pn(e, s, c, l, u, d, o, a);
				return;
			case "select":
				for (o in m = s = c = p = null, n) if (l = n[o], n.hasOwnProperty(o) && l != null) switch (o) {
					case "value": break;
					case "multiple": m = l;
					default: r.hasOwnProperty(o) || hp(e, t, o, null, r, l);
				}
				for (a in r) if (o = r[a], l = n[a], r.hasOwnProperty(a) && (o != null || l != null)) switch (a) {
					case "value":
						o !== l && (tn = !0), p = o;
						break;
					case "defaultValue":
						o !== l && (tn = !0), c = o;
						break;
					case "multiple": o !== l && (tn = !0), s = o;
					default: o !== l && hp(e, t, a, o, r, l);
				}
				t = c, n = s, r = m, p == null ? !!r != !!n && (t == null ? gn(e, !!n, n ? [] : "", !1) : gn(e, !!n, t, !0)) : gn(e, !!n, p, !1);
				return;
			case "textarea":
				for (c in m = p = null, n) if (a = n[c], n.hasOwnProperty(c) && a != null && !r.hasOwnProperty(c)) switch (c) {
					case "value": break;
					case "children": break;
					default: hp(e, t, c, null, r, a);
				}
				for (s in r) if (a = r[s], o = n[s], r.hasOwnProperty(s) && (a != null || o != null)) switch (s) {
					case "value":
						a !== o && (tn = !0), p = a;
						break;
					case "defaultValue":
						a !== o && (tn = !0), m = a;
						break;
					case "children": break;
					case "dangerouslySetInnerHTML":
						if (a != null) throw Error(i(91));
						break;
					default: a !== o && hp(e, t, s, a, r, o);
				}
				_n(e, p, m);
				return;
			case "option":
				for (var h in n) if (p = n[h], n.hasOwnProperty(h) && p != null && !r.hasOwnProperty(h)) switch (h) {
					case "selected":
						e.selected = !1;
						break;
					default: hp(e, t, h, null, r, p);
				}
				for (l in r) if (p = r[l], m = n[l], r.hasOwnProperty(l) && p !== m && (p != null || m != null)) switch (l) {
					case "selected":
						p !== m && (tn = !0), e.selected = p && typeof p != "function" && typeof p != "symbol";
						break;
					default: hp(e, t, l, p, r, m);
				}
				return;
			case "img":
			case "link":
			case "area":
			case "base":
			case "br":
			case "col":
			case "embed":
			case "hr":
			case "keygen":
			case "meta":
			case "param":
			case "source":
			case "track":
			case "wbr":
			case "menuitem":
				for (var g in n) p = n[g], n.hasOwnProperty(g) && p != null && !r.hasOwnProperty(g) && hp(e, t, g, null, r, p);
				for (u in r) if (p = r[u], m = n[u], r.hasOwnProperty(u) && p !== m && (p != null || m != null)) switch (u) {
					case "children":
					case "dangerouslySetInnerHTML":
						if (p != null) throw Error(i(137, t));
						break;
					default: hp(e, t, u, p, r, m);
				}
				return;
			default: if (Cn(t)) {
				for (var _ in n) p = n[_], n.hasOwnProperty(_) && p !== void 0 && !r.hasOwnProperty(_) && gp(e, t, _, void 0, r, p);
				for (d in r) p = r[d], m = n[d], !r.hasOwnProperty(d) || p === m || p === void 0 && m === void 0 || gp(e, t, d, p, r, m);
				return;
			}
		}
		for (var v in n) p = n[v], n.hasOwnProperty(v) && p != null && !r.hasOwnProperty(v) && hp(e, t, v, null, r, p);
		for (f in r) p = r[f], m = n[f], !r.hasOwnProperty(f) || p === m || p == null && m == null || hp(e, t, f, p, r, m);
	}
	function bp(e) {
		switch (e) {
			case "css":
			case "script":
			case "font":
			case "img":
			case "image":
			case "input":
			case "link": return !0;
			default: return !1;
		}
	}
	function xp() {
		if (typeof performance.getEntriesByType == "function") {
			for (var e = 0, t = 0, n = performance.getEntriesByType("resource"), r = 0; r < n.length; r++) {
				var i = n[r], a = i.transferSize, o = i.initiatorType, s = i.duration;
				if (a && s && bp(o)) {
					for (o = 0, s = i.responseEnd, r += 1; r < n.length; r++) {
						var c = n[r], l = c.startTime;
						if (l > s) break;
						var u = c.transferSize, d = c.initiatorType;
						u && bp(d) && (c = c.responseEnd, o += u * (c < s ? 1 : (s - l) / (c - l)));
					}
					if (--r, t += 8 * (a + o) / (i.duration / 1e3), e++, 10 < e) break;
				}
			}
			if (0 < e) return t / e / 1e6;
		}
		return navigator.connection && (e = navigator.connection.downlink, typeof e == "number") ? e : 5;
	}
	var Sp = null, Cp = null;
	function wp(e) {
		return e.nodeType === 9 ? e : e.ownerDocument;
	}
	function Tp(e) {
		switch (e) {
			case "http://www.w3.org/2000/svg": return 1;
			case "http://www.w3.org/1998/Math/MathML": return 2;
			default: return 0;
		}
	}
	function Ep(e, t) {
		if (e === 0) switch (t) {
			case "svg": return 1;
			case "math": return 2;
			default: return 0;
		}
		return e === 1 && t === "foreignObject" ? 0 : e;
	}
	function Dp(e, t, n, r) {
		return n = wp(n).createElement(e), n[jt] = r, n[Mt] = t, _p(n, e, t), Gt(n), n;
	}
	function Op(e, t) {
		return e === "textarea" || e === "noscript" || typeof t.children == "string" || typeof t.children == "number" || typeof t.children == "bigint" || typeof t.dangerouslySetInnerHTML == "object" && t.dangerouslySetInnerHTML !== null && t.dangerouslySetInnerHTML.__html != null;
	}
	var kp = null;
	function Ap() {
		var e = window.event;
		return e && e.type === "popstate" ? e !== kp && (kp = e, !0) : (kp = null, !1);
	}
	var jp = typeof setTimeout == "function" ? setTimeout : void 0, Mp = typeof clearTimeout == "function" ? clearTimeout : void 0, Np = typeof Promise == "function" ? Promise : void 0, Pp = typeof requestAnimationFrame == "function" ? requestAnimationFrame : jp, Fp = typeof queueMicrotask == "function" ? queueMicrotask : Np === void 0 ? jp : function(e) {
		return Np.resolve(null).then(e).catch(Ip);
	};
	function Ip(e) {
		setTimeout(function() {
			throw e;
		});
	}
	function Lp(e) {
		return e === "head";
	}
	function Rp(e, t) {
		var n = t, r = 0;
		do {
			var i = n.nextSibling;
			if (e.removeChild(n), i && i.nodeType === 8) {
				if (n = i.data, n === "/$" || n === "/&") {
					if (r === 0) {
						e.removeChild(i), Zh(t);
						return;
					}
					r--;
				} else if (n === "$" || n === "$?" || n === "$~" || n === "$!" || n === "&") r++;
				else if (n === "html") Mm(e.ownerDocument.documentElement);
				else if (n === "head") {
					n = e.ownerDocument.head, Mm(n);
					for (var a = n.firstChild; a;) {
						var o = a.nextSibling, s = a.nodeName;
						a[Rt] || s === "SCRIPT" || s === "STYLE" || s === "LINK" && a.rel.toLowerCase() === "stylesheet" || n.removeChild(a), a = o;
					}
				} else n === "body" && Mm(e.ownerDocument.body);
			}
			n = i;
		} while (n);
		Zh(t);
	}
	function zp(e, t) {
		var n = e;
		e = 0;
		do {
			var r = n.nextSibling;
			if (n.nodeType === 1 ? t ? (n._stashedDisplay = n.style.display, n.style.display = "none") : (n.style.display = n._stashedDisplay || "", n.getAttribute("style") === "" && n.removeAttribute("style")) : n.nodeType === 3 && (t ? (n._stashedText = n.nodeValue, n.nodeValue = "") : n.nodeValue = n._stashedText || ""), r && r.nodeType === 8) {
				if (n = r.data, n === "/$") {
					if (e === 0) break;
					e--;
				} else n !== "$" && n !== "$?" && n !== "$~" && n !== "$!" || e++;
			}
			n = r;
		} while (n);
	}
	function Bp(e, t, n) {
		if (t = CSS.escape(t) === t ? t : "r-" + btoa(t).replace(/=/g, ""), e.style.viewTransitionName = t, n != null && (e.style.viewTransitionClass = n), n = getComputedStyle(e), n.display === "inline") {
			if (t = e.getClientRects(), t.length === 1) var r = 1;
			else for (var i = r = 0; i < t.length; i++) {
				var a = t[i];
				0 < a.width && 0 < a.height && r++;
			}
			r === 1 && (e = e.style, e.display = t.length === 1 ? "inline-block" : "block", e.marginTop = "-" + n.paddingTop, e.marginBottom = "-" + n.paddingBottom);
		}
	}
	function Vp(e, t) {
		e = e.style, t = t.style;
		var n = t == null ? null : t.hasOwnProperty("viewTransitionName") ? t.viewTransitionName : t.hasOwnProperty("view-transition-name") ? t["view-transition-name"] : null;
		e.viewTransitionName = n == null || typeof n == "boolean" ? "" : ("" + n).trim(), n = t == null ? null : t.hasOwnProperty("viewTransitionClass") ? t.viewTransitionClass : t.hasOwnProperty("view-transition-class") ? t["view-transition-class"] : null, e.viewTransitionClass = n == null || typeof n == "boolean" ? "" : ("" + n).trim(), e.display === "inline-block" && (t == null ? e.display = e.margin = "" : (n = t.display, e.display = n == null || typeof n == "boolean" ? "" : n, n = t.margin, n == null ? (n = t.hasOwnProperty("marginTop") ? t.marginTop : t["margin-top"], e.marginTop = n == null || typeof n == "boolean" ? "" : n, t = t.hasOwnProperty("marginBottom") ? t.marginBottom : t["margin-bottom"], e.marginBottom = t == null || typeof t == "boolean" ? "" : t) : e.margin = n));
	}
	function Hp(e, t, n) {
		return n = n.ownerDocument.defaultView, {
			rect: e,
			abs: t.position === "absolute" || t.position === "fixed",
			clip: t.clipPath !== "none" || t.overflow !== "visible" || t.filter !== "none" || t.mask !== "none" || t.mask !== "none" || t.borderRadius !== "0px",
			view: 0 <= e.bottom && 0 <= e.right && e.top <= n.innerHeight && e.left <= n.innerWidth
		};
	}
	function Up(e) {
		return Hp(e.getBoundingClientRect(), getComputedStyle(e), e);
	}
	function Wp(e) {
		var t = e.getBoundingClientRect();
		t = new DOMRect(t.x + 2e4, t.y + 2e4, t.width, t.height);
		var n = getComputedStyle(e);
		return Hp(t, n, e);
	}
	function Gp(e) {
		return e.documentElement.clientHeight;
	}
	function Kp(e) {
		this.addEventListener("load", e), this.addEventListener("error", e);
	}
	function qp(e, t, n, r, i, a, o, s, c) {
		var l = t.nodeType === 9 ? t : t.ownerDocument;
		try {
			var u = l.startViewTransition({
				update: function() {
					var t = l.defaultView, n = t.navigation && t.navigation.transition, o = l.fonts.status;
					r();
					var s = [];
					if (o === "loaded" && (Gp(l), l.fonts.status === "loading" && s.push(l.fonts.ready)), o = s.length, e !== null) for (var c = e.suspenseyImages, u = 0, d = 0; d < c.length; d++) {
						var f = c[d];
						if (!f.complete) {
							var p = f.getBoundingClientRect();
							if (0 < p.bottom && 0 < p.right && p.top < t.innerHeight && p.left < t.innerWidth) {
								if (u += lh(f), u > fh) {
									s.length = o;
									break;
								}
								f = new Promise(Kp.bind(f)), s.push(f);
							}
						}
					}
					if (0 < s.length) return t = Promise.race([Promise.all(s), new Promise(function(e) {
						return setTimeout(e, 500);
					})]).then(i, i), (n ? Promise.allSettled([n.finished, t]) : t).then(a, a);
					if (i(), n) return n.finished.then(a, a);
					a();
				},
				types: n
			});
			l.__reactViewTransition = u;
			var d = [];
			return u.ready.then(function() {
				for (var e = l.documentElement.getAnimations({ subtree: !0 }), t = 0; t < e.length; t++) {
					var n = e[t], r = n.effect, i = r.pseudoElement;
					if (i != null && i.startsWith("::view-transition")) {
						d.push(n), n = r.getKeyframes();
						for (var a = i = void 0, s = !0, c = 0; c < n.length; c++) {
							var u = n[c], f = u.width;
							if (i === void 0) i = f;
							else if (i !== f) {
								s = !1;
								break;
							}
							if (f = u.height, a === void 0) a = f;
							else if (a !== f) {
								s = !1;
								break;
							}
							delete u.width, delete u.height, u.transform === "none" && delete u.transform;
						}
						s && i !== void 0 && a !== void 0 && (r.setKeyframes(n), s = getComputedStyle(r.target, r.pseudoElement), s.width !== i || s.height !== a) && (s = n[0], s.width = i, s.height = a, s = n[n.length - 1], s.width = i, s.height = a, r.setKeyframes(n));
					}
				}
				o();
			}, function(e) {
				l.__reactViewTransition === u && (l.__reactViewTransition = null);
				try {
					if (typeof e == "object" && e) switch (e.name) {
						case "InvalidStateError": (e.message === "View transition was skipped because document visibility state is hidden." || e.message === "Skipping view transition because document visibility state has become hidden." || e.message === "Skipping view transition because viewport size changed." || e.message === "Transition was aborted because of invalid state") && (e = null);
					}
					e !== null && c(e);
				} finally {
					r(), i(), o();
				}
			}), u.finished.finally(function() {
				for (var e = 0; e < d.length; e++) d[e].cancel();
				l.__reactViewTransition === u && (l.__reactViewTransition = null), s();
			}), u;
		} catch {
			return r(), i(), o(), null;
		}
	}
	function Jp(e, t) {
		this._scope = document.documentElement, this._selector = "::view-transition-" + e + "(" + t + ")";
	}
	Jp.prototype.animate = function(e, t) {
		return t = typeof t == "number" ? { duration: t } : E({}, t), t.pseudoElement = this._selector, this._scope.animate(e, t);
	}, Jp.prototype.getAnimations = function() {
		for (var e = this._scope, t = this._selector, n = e.getAnimations({ subtree: !0 }), r = [], i = 0; i < n.length; i++) {
			var a = n[i].effect;
			a !== null && a.target === e && a.pseudoElement === t && r.push(n[i]);
		}
		return r;
	}, Jp.prototype.getComputedStyle = function() {
		return getComputedStyle(this._scope, this._selector);
	};
	function Yp(e) {
		return {
			name: e,
			group: new Jp("group", e),
			imagePair: new Jp("image-pair", e),
			old: new Jp("old", e),
			new: new Jp("new", e)
		};
	}
	function Xp(e) {
		this._fragmentFiber = e, this._observers = this._eventListeners = null;
	}
	Xp.prototype.addEventListener = function(e, t, n) {
		var r = null, i = null;
		if (!(n != null && typeof n != "boolean" && (r = n.signal || null, r !== null && r.aborted))) {
			this._eventListeners === null && (this._eventListeners = []);
			var a = this._eventListeners;
			if (tm(a, e, t, n) === -1) {
				var o = this, s = t;
				n != null && typeof n != "boolean" && !0 === n.once && (s = function(r) {
					o.removeEventListener(e, t, n), typeof t == "function" ? t.call(this, r) : t.handleEvent(r);
				}), r !== null && (i = o.removeEventListener.bind(o, e, t, n), r.addEventListener("abort", i, { once: !0 }), i = r.removeEventListener.bind(r, "abort", i)), r = $p(n), a.push({
					type: e,
					listener: t,
					optionsOrUseCapture: n,
					attachedListener: s,
					cleanup: i
				}), h(this._fragmentFiber.child, !1, Zp, e, s, r);
			}
			this._eventListeners = a;
		}
	};
	function Zp(e, t, n, r) {
		return b(e).addEventListener(t, n, r), !1;
	}
	Xp.prototype.removeEventListener = function(e, t, n) {
		var r = this._eventListeners;
		if (r !== null && (t = tm(r, e, t, n), t !== -1)) {
			var i = r[t];
			n = i.attachedListener;
			var a = i.cleanup;
			i = $p(i.optionsOrUseCapture), h(this._fragmentFiber.child, !1, Qp, e, n, i), r.splice(t, 1), a !== null && a();
		}
	};
	function Qp(e, t, n, r) {
		return b(e).removeEventListener(t, n, r), !1;
	}
	function $p(e) {
		return e != null && typeof e != "boolean" && (!0 === e.once || e.signal instanceof AbortSignal) ? {
			capture: e.capture,
			passive: e.passive
		} : e;
	}
	function em(e) {
		return e == null ? "c=0" : typeof e == "boolean" ? "c=" + (e ? "1" : "0") : "c=" + (e.capture ? "1" : "0");
	}
	function tm(e, t, n, r) {
		if (e.length === 0) return -1;
		r = em(r);
		for (var i = 0; i < e.length; i++) {
			var a = e[i];
			if (a.type === t && a.listener === n && em(a.optionsOrUseCapture) === r) return i;
		}
		return -1;
	}
	Xp.prototype.dispatchEvent = function(e) {
		var t = g(this._fragmentFiber);
		if (t === null) return !0;
		t = b(t);
		var n = this._eventListeners;
		if (n !== null && 0 < n.length || !e.bubbles) {
			var r = t.nodeType === 9 ? t.createComment("") : document.createTextNode("");
			if (n) for (var i = 0; i < n.length; i++) {
				var a = n[i];
				r.addEventListener(a.type, a.attachedListener, $p(a.optionsOrUseCapture));
			}
			if (t.appendChild(r), e = r.dispatchEvent(e), n) for (i = 0; i < n.length; i++) a = n[i], r.removeEventListener(a.type, a.attachedListener, $p(a.optionsOrUseCapture));
			return t.removeChild(r), e;
		}
		return t.dispatchEvent(e);
	}, Xp.prototype.focus = function(e) {
		h(this._fragmentFiber.child, !0, nm, e, void 0, void 0);
	};
	function nm(e, t) {
		return e.tag !== 6 && (e = b(e), Om(e, t));
	}
	Xp.prototype.focusLast = function(e) {
		var t = [];
		h(this._fragmentFiber.child, !0, rm, t, void 0, void 0);
		for (var n = t.length - 1; 0 <= n && !nm(t[n], e); n--);
	};
	function rm(e, t) {
		return t.push(e), !1;
	}
	Xp.prototype.blur = function() {
		var e = g(this._fragmentFiber);
		e !== null && (e = b(e), e = wp(e).activeElement, e !== null && h(this._fragmentFiber.child, !1, im, e, void 0, void 0));
	};
	function im(e, t) {
		return e.tag !== 6 && (e = b(e), e === t || e.contains(t) ? (t.blur(), !0) : !1);
	}
	Xp.prototype.observeUsing = function(e) {
		this._observers === null && (this._observers = /* @__PURE__ */ new Set()), this._observers.add(e), h(this._fragmentFiber.child, !1, am, e, void 0, void 0);
	};
	function am(e, t) {
		return e.tag !== 6 && (e = b(e), t.observe(e), !1);
	}
	Xp.prototype.unobserveUsing = function(e) {
		var t = this._observers;
		if (t !== null && t.has(e)) {
			t.delete(e), h(this._fragmentFiber.child, !1, om, e, void 0, void 0);
			for (var n = t = 0; n < sm.length; n++) {
				var r = sm[n];
				r.fragmentInstance === this && r.observer === e ? e.unobserve(r.instance) : sm[t++] = r;
			}
			sm.length = t;
		}
	};
	function om(e, t) {
		return e.tag !== 6 && (e = b(e), t.unobserve(e), !1);
	}
	var sm = [], cm = !1;
	function lm(e, t, n) {
		sm.push({
			fragmentInstance: e,
			observer: t,
			instance: n
		}), cm || (cm = !0, km(function() {
			cm = !1;
			var e = sm;
			sm = [];
			for (var t = 0; t < e.length; t++) {
				var n = e[t];
				n.observer.unobserve(n.instance);
			}
		}));
	}
	Xp.prototype.getClientRects = function() {
		var e = [];
		return h(this._fragmentFiber.child, !1, um, e, void 0, void 0), e;
	};
	function um(e, t) {
		if (e.tag === 6) {
			e = e.stateNode;
			var n = e.ownerDocument.createRange();
			n.selectNodeContents(e), t.push.apply(t, n.getClientRects());
		} else e = b(e), t.push.apply(t, e.getClientRects());
		return !1;
	}
	Xp.prototype.getRootNode = function(e) {
		var t = g(this._fragmentFiber);
		return t === null ? this : b(t).getRootNode(e);
	}, Xp.prototype.compareDocumentPosition = function(e) {
		var t = g(this._fragmentFiber);
		if (t === null) return Node.DOCUMENT_POSITION_DISCONNECTED;
		var n = [];
		h(this._fragmentFiber.child, !1, rm, n, void 0, void 0);
		var r = b(t);
		if (n.length === 0) {
			if (n = r, _(this._fragmentFiber)) {
				a: {
					for (t = this._fragmentFiber.return; t !== null;) {
						if (t.tag === 4) {
							t = t.stateNode.containerInfo;
							break a;
						}
						if (t.tag === 3 || t.tag === 5 || t.tag === 27) break;
						t = t.return;
					}
					t = null;
				}
				t != null && (n = t);
			}
			t = this._fragmentFiber;
			var i = r = n.compareDocumentPosition(e);
			return n === e ? i = Node.DOCUMENT_POSITION_CONTAINS : r & Node.DOCUMENT_POSITION_CONTAINED_BY && (n = v(t)[1], n === null ? i = Node.DOCUMENT_POSITION_PRECEDING : (e = b(n).compareDocumentPosition(e), i = e === 0 || e & Node.DOCUMENT_POSITION_FOLLOWING ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING)), i |= Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
		}
		t = b(n[0]), i = b(n[n.length - 1]);
		var a = _(this._fragmentFiber) ? t.parentElement : r;
		if (a == null) return Node.DOCUMENT_POSITION_DISCONNECTED;
		r = a.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_CONTAINED_BY, a = a.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_CONTAINED_BY;
		var o = t.compareDocumentPosition(e), s = i.compareDocumentPosition(e), c = o & Node.DOCUMENT_POSITION_CONTAINED_BY || s & Node.DOCUMENT_POSITION_CONTAINED_BY;
		return s = r && a && o & Node.DOCUMENT_POSITION_FOLLOWING && s & Node.DOCUMENT_POSITION_PRECEDING, t = r && t === e || a && i === e || c || s ? Node.DOCUMENT_POSITION_CONTAINED_BY : !r && t === e || !a && i === e ? Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC : o, t & Node.DOCUMENT_POSITION_DISCONNECTED || t & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC || dm(t, this._fragmentFiber, n[0], n[n.length - 1], e) ? t : Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
	};
	function dm(e, t, n, r, i) {
		var a = Vt(i);
		if (e & Node.DOCUMENT_POSITION_CONTAINED_BY) {
			if (n = !!a) a: {
				for (; a !== null;) {
					if (a.tag === 7 && (a === t || a.alternate === t)) {
						n = !0;
						break a;
					}
					a = a.return;
				}
				n = !1;
			}
			return n;
		}
		if (e & Node.DOCUMENT_POSITION_CONTAINS) {
			if (a === null) return a = i.ownerDocument, i === a || i === a.documentElement || i === a.body;
			a: {
				for (a = t, t = g(t); a !== null;) {
					if (!(a.tag !== 5 && a.tag !== 3 && a.tag !== 27 || a !== t && a.alternate !== t)) {
						a = !0;
						break a;
					}
					a = a.return;
				}
				a = !1;
			}
			return a;
		}
		return e & Node.DOCUMENT_POSITION_PRECEDING ? ((t = !!a) && !(t = a === n) && (t = ee(n, a, T), t === null ? t = !1 : (h(t, !0, C, a, n), a = x, x = null, t = a !== null)), t) : e & Node.DOCUMENT_POSITION_FOLLOWING ? ((t = !!a) && !(t = a === r) && (t = ee(r, a, T), t === null ? t = !1 : (h(t, !0, w, a, r), a = x, S = x = null, t = a !== null)), t) : !1;
	}
	function fm(e, t) {
		var n = e.ownerDocument.createRange();
		n.selectNodeContents(e), e = n.getBoundingClientRect(), window.scrollTo(window.scrollX + e.left, t ? window.scrollY + e.top : window.scrollY + e.bottom - window.innerHeight);
	}
	Xp.prototype.scrollIntoView = function(e) {
		if (typeof e == "object") throw Error(i(566));
		var t = [];
		h(this._fragmentFiber.child, !1, rm, t, void 0, void 0);
		var n = !1 !== e;
		if (t.length === 0) {
			var r = v(this._fragmentFiber);
			if (r = n ? r[1] || r[0] || g(this._fragmentFiber) : r[0] || r[1], r === null) return;
			if (r.tag === 6) {
				e = b(r), fm(e, n);
				return;
			}
			if (r = b(r), r.nodeType !== 9) {
				if (r.nodeType === 11) {
					n = "host" in r ? r.host : null, n !== null && n.scrollIntoView(e);
					return;
				}
				r.scrollIntoView(e);
			}
		}
		for (r = n ? t.length - 1 : 0; r !== (n ? -1 : t.length);) {
			var a = t[r];
			a.tag === 6 ? (a = b(a), fm(a, n)) : b(a).scrollIntoView(e), r += n ? -1 : 1;
		}
	};
	function pm(e, t) {
		return e = b(e), mm(e, t), !1;
	}
	function mm(e, t) {
		e.reactFragments ??= /* @__PURE__ */ new Set(), e.reactFragments.add(t);
	}
	function hm(e, t) {
		var n = t._eventListeners;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = n[r];
			e.addEventListener(i.type, i.attachedListener, $p(i.optionsOrUseCapture));
		}
		e.nodeType !== 3 && (n = t._observers, n !== null && n.forEach(function(n) {
			for (var r = 0, i = 0; i < sm.length; i++) {
				var a = sm[i];
				(a.fragmentInstance !== t || a.observer !== n || a.instance !== e) && (sm[r++] = a);
			}
			sm.length = r, n.observe(e);
		}), mm(e, t));
	}
	function gm(e, t) {
		var n = t._eventListeners;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = n[r];
			e.removeEventListener(i.type, i.attachedListener, $p(i.optionsOrUseCapture));
		}
		e.nodeType !== 3 && (n = t._observers, n !== null && n.forEach(function(n) {
			typeof n.rootMargin == "string" ? lm(t, n, e) : n.unobserve(e);
		}), e.reactFragments != null && e.reactFragments.delete(t));
	}
	function _m(e) {
		var t = e.firstChild;
		for (t && t.nodeType === 10 && (t = t.nextSibling); t;) {
			var n = t;
			switch (t = t.nextSibling, n.nodeName) {
				case "HTML":
				case "HEAD":
				case "BODY":
					_m(n), Bt(n);
					continue;
				case "SCRIPT":
				case "STYLE": continue;
				case "LINK": if (n.rel.toLowerCase() === "stylesheet") continue;
			}
			e.removeChild(n);
		}
	}
	function vm(e, t, n, r) {
		for (; e.nodeType === 1;) {
			var i = n;
			if (e.nodeName.toLowerCase() !== t.toLowerCase()) {
				if (!r && (e.nodeName !== "INPUT" || e.type !== "hidden")) break;
			} else if (!r) {
				if (t === "input" && e.type === "hidden") {
					var a = i.name == null ? null : "" + i.name;
					if (i.type === "hidden" && e.getAttribute("name") === a) return e;
				} else return e;
			} else if (!e[Rt]) switch (t) {
				case "meta":
					if (!e.hasAttribute("itemprop")) break;
					return e;
				case "link":
					if (a = e.getAttribute("rel"), a === "stylesheet" && e.hasAttribute("data-precedence") || a !== i.rel || e.getAttribute("href") !== (i.href == null || i.href === "" ? null : i.href) || e.getAttribute("crossorigin") !== (i.crossOrigin == null ? null : i.crossOrigin) || e.getAttribute("title") !== (i.title == null ? null : i.title)) break;
					return e;
				case "style":
					if (e.hasAttribute("data-precedence")) break;
					return e;
				case "script":
					if (a = e.getAttribute("src"), (a !== (i.src == null ? null : i.src) || e.getAttribute("type") !== (i.type == null ? null : i.type) || e.getAttribute("crossorigin") !== (i.crossOrigin == null ? null : i.crossOrigin)) && a && e.hasAttribute("async") && !e.hasAttribute("itemprop")) break;
					return e;
				default: return e;
			}
			if (e = wm(e.nextSibling), e === null) break;
		}
		return null;
	}
	function ym(e, t, n) {
		if (t === "") return null;
		for (; e.nodeType !== 3;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !n || (e = wm(e.nextSibling), e === null)) return null;
		return e;
	}
	function bm(e, t) {
		for (; e.nodeType !== 8;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !t || (e = wm(e.nextSibling), e === null)) return null;
		return e;
	}
	function xm(e) {
		return e.data === "$?" || e.data === "$~";
	}
	function Sm(e) {
		return e.data === "$!" || e.data === "$?" && e.ownerDocument.readyState !== "loading";
	}
	function Cm(e, t) {
		var n = e.ownerDocument;
		if (e.data === "$~") e._reactRetry = t;
		else if (e.data !== "$?" || n.readyState !== "loading") t();
		else {
			var r = function() {
				t(), n.removeEventListener("DOMContentLoaded", r);
			};
			n.addEventListener("DOMContentLoaded", r), e._reactRetry = r;
		}
	}
	function wm(e) {
		for (; e != null; e = e.nextSibling) {
			var t = e.nodeType;
			if (t === 1 || t === 3) break;
			if (t === 8) {
				if (t = e.data, t === "$" || t === "$!" || t === "$?" || t === "$~" || t === "&" || t === "F!" || t === "F") break;
				if (t === "/$" || t === "/&") return null;
			}
		}
		return e;
	}
	var Tm = null;
	function Em(e) {
		e = e.nextSibling;
		for (var t = 0; e;) {
			if (e.nodeType === 8) {
				var n = e.data;
				if (n === "/$" || n === "/&") {
					if (t === 0) return wm(e.nextSibling);
					t--;
				} else n !== "$" && n !== "$!" && n !== "$?" && n !== "$~" && n !== "&" || t++;
			}
			e = e.nextSibling;
		}
		return null;
	}
	function Dm(e) {
		e = e.previousSibling;
		for (var t = 0; e;) {
			if (e.nodeType === 8) {
				var n = e.data;
				if (n === "$" || n === "$!" || n === "$?" || n === "$~" || n === "&") {
					if (t === 0) return e;
					t--;
				} else n !== "/$" && n !== "/&" || t++;
			}
			e = e.previousSibling;
		}
		return null;
	}
	function Om(e, t) {
		function n() {
			r = !0;
		}
		if (e.ownerDocument.activeElement === e) return !0;
		var r = !1;
		try {
			e.ownerDocument.addEventListener("focus", n, !0), (e.focus || HTMLElement.prototype.focus).call(e, t);
		} finally {
			e.ownerDocument.removeEventListener("focus", n, !0);
		}
		return r;
	}
	function km(e) {
		Pp(function() {
			Pp(function(t) {
				return e(t);
			});
		});
	}
	function Am(e, t, n) {
		switch (t = wp(n), e) {
			case "html":
				if (e = t.documentElement, !e) throw Error(i(452));
				return e;
			case "head":
				if (e = t.head, !e) throw Error(i(453));
				return e;
			case "body":
				if (e = t.body, !e) throw Error(i(454));
				return e;
			default: throw Error(i(451));
		}
	}
	function jm(e, t, n) {
		for (var r in n) {
			var i = n[r];
			n.hasOwnProperty(r) && i != null && hp(e, t, r, null, vp, i);
		}
		n.dangerouslySetInnerHTML != null && (e.textContent = ""), e.onclick === Dn && (e.onclick = null), Bt(e);
	}
	function Mm(e) {
		for (var t = e.attributes; t.length;) e.removeAttributeNode(t[0]);
		Bt(e);
	}
	var Nm = /* @__PURE__ */ new Map(), Pm = /* @__PURE__ */ new Set();
	function Fm(e) {
		if (typeof e.getRootNode == "function") {
			var t = e.getRootNode();
			if (t.nodeType === 9 || t.nodeType === 11) return t;
		}
		return e.nodeType === 9 ? e : e.ownerDocument;
	}
	var Im = Se.d;
	Se.d = {
		f: Lm,
		r: Rm,
		D: Vm,
		C: Hm,
		L: Um,
		m: z,
		X: Gm,
		S: Wm,
		M: Km
	};
	function Lm() {
		var e = Im.f(), t = Qd();
		return e || t;
	}
	function Rm(e) {
		var t = Ht(e);
		t !== null && t.tag === 5 && t.type === "form" ? cc(t) : Im.r(e);
	}
	var zm = typeof document > "u" ? null : document;
	function Bm(e, t, n) {
		var r = zm;
		if (r && typeof t == "string" && t) {
			var i = fn(t);
			i = "link[rel=\"" + e + "\"][href=\"" + i + "\"]", typeof n == "string" && (i += "[crossorigin=\"" + n + "\"]"), Pm.has(i) || (Pm.add(i), e = {
				rel: e,
				crossOrigin: n,
				href: t
			}, r.querySelector(i) === null && (t = r.createElement("link"), _p(t, "link", e), Gt(t), r.head.appendChild(t)));
		}
	}
	function Vm(e) {
		Im.D(e), Bm("dns-prefetch", e, null);
	}
	function Hm(e, t) {
		Im.C(e, t), Bm("preconnect", e, t);
	}
	function Um(e, t, n) {
		Im.L(e, t, n);
		var r = zm;
		if (r && e && t) {
			var i = "link[rel=\"preload\"][as=\"" + fn(t) + "\"]";
			t === "image" && n && n.imageSrcSet ? (i += "[imagesrcset=\"" + fn(n.imageSrcSet) + "\"]", typeof n.imageSizes == "string" && (i += "[imagesizes=\"" + fn(n.imageSizes) + "\"]")) : i += "[href=\"" + fn(e) + "\"]";
			var a = i;
			switch (t) {
				case "style":
					a = Jm(e);
					break;
				case "script": a = Qm(e);
			}
			if (!(Nm.has(a) || (e = E({
				rel: "preload",
				href: t === "image" && n && n.imageSrcSet ? void 0 : e,
				as: t
			}, n), Nm.set(a, e), r.querySelector(i) !== null || t === "style" && r.querySelector(Ym(a)) || t === "script" && r.querySelector($m(a))))) {
				var o = r.createElement("link");
				_p(o, "link", e), t === "style" && (o[zt] = !0, o.onload = o.onerror = function() {
					Kt(o);
				}), Gt(o), r.head.appendChild(o);
			}
		}
	}
	function z(e, t) {
		Im.m(e, t);
		var n = zm;
		if (n && e) {
			var r = t && typeof t.as == "string" ? t.as : "script", i = "link[rel=\"modulepreload\"][as=\"" + fn(r) + "\"][href=\"" + fn(e) + "\"]", a = i;
			switch (r) {
				case "audioworklet":
				case "paintworklet":
				case "serviceworker":
				case "sharedworker":
				case "worker":
				case "script": a = Qm(e);
			}
			if (!Nm.has(a) && (e = E({
				rel: "modulepreload",
				href: e
			}, t), Nm.set(a, e), n.querySelector(i) === null)) {
				switch (r) {
					case "audioworklet":
					case "paintworklet":
					case "serviceworker":
					case "sharedworker":
					case "worker":
					case "script": if (n.querySelector($m(a))) return;
				}
				r = n.createElement("link"), _p(r, "link", e), Gt(r), n.head.appendChild(r);
			}
		}
	}
	function Wm(e, t, n) {
		Im.S(e, t, n);
		var r = zm;
		if (r && e) {
			var i = Wt(r).hoistableStyles, a = Jm(e);
			t ||= "default";
			var o = i.get(a);
			if (!o) {
				var s = {
					loading: 0,
					preload: null
				};
				if (o = r.querySelector(Ym(a))) s.loading = 5;
				else {
					e = E({
						rel: "stylesheet",
						href: e,
						"data-precedence": t
					}, n), (n = Nm.get(a)) && th(e, n);
					var c = o = r.createElement("link");
					Gt(c), _p(c, "link", e), c._p = new Promise(function(e, t) {
						c.onload = e, c.onerror = t;
					}), c.addEventListener("load", function() {
						s.loading |= 1;
					}), c.addEventListener("error", function() {
						s.loading |= 2;
					}), s.loading |= 4, eh(o, t, r);
				}
				o = {
					type: "stylesheet",
					instance: o,
					count: 1,
					state: s
				}, i.set(a, o);
			}
		}
	}
	function Gm(e, t) {
		Im.X(e, t);
		var n = zm;
		if (n && e) {
			var r = Wt(n).hoistableScripts, i = Qm(e), a = r.get(i);
			a || (a = n.querySelector($m(i)), a || (e = E({
				src: e,
				async: !0
			}, t), (t = Nm.get(i)) && nh(e, t), a = n.createElement("script"), Gt(a), _p(a, "link", e), n.head.appendChild(a)), a = {
				type: "script",
				instance: a,
				count: 1,
				state: null
			}, r.set(i, a));
		}
	}
	function Km(e, t) {
		Im.M(e, t);
		var n = zm;
		if (n && e) {
			var r = Wt(n).hoistableScripts, i = Qm(e), a = r.get(i);
			a || (a = n.querySelector($m(i)), a || (e = E({
				src: e,
				async: !0,
				type: "module"
			}, t), (t = Nm.get(i)) && nh(e, t), a = n.createElement("script"), Gt(a), _p(a, "link", e), n.head.appendChild(a)), a = {
				type: "script",
				instance: a,
				count: 1,
				state: null
			}, r.set(i, a));
		}
	}
	function qm(e, t, n, r) {
		var a = (a = je.current) ? Fm(a) : null;
		if (!a) throw Error(i(446));
		switch (e) {
			case "meta":
			case "title": return null;
			case "style": return typeof n.precedence == "string" && typeof n.href == "string" ? (n = Jm(n.href), t = Wt(a).hoistableStyles, r = t.get(n), r || (r = {
				type: "style",
				instance: null,
				count: 0,
				state: null
			}, t.set(n, r)), r) : {
				type: "void",
				instance: null,
				count: 0,
				state: null
			};
			case "link":
				if (n.rel === "stylesheet" && typeof n.href == "string" && typeof n.precedence == "string") {
					e = Jm(n.href);
					var o = Wt(a).hoistableStyles, s = o.get(e);
					if (s || (a = a.ownerDocument || a, s = {
						type: "stylesheet",
						instance: null,
						count: 0,
						state: {
							loading: 0,
							preload: null
						}
					}, o.set(e, s), (o = a.querySelector(Ym(e))) ? o._p || (s.instance = o, s.state.loading = 5) : (o = Nm.get(e), o || (o = {
						rel: "preload",
						as: "style",
						href: n.href,
						crossOrigin: n.crossOrigin,
						integrity: n.integrity,
						media: n.media,
						hrefLang: n.hrefLang,
						referrerPolicy: n.referrerPolicy
					}, Nm.set(e, o)), Zm(a, e, o, s.state))), t && r === null) throw Error(i(528, ""));
					return s;
				}
				if (t && r !== null) throw Error(i(529, ""));
				return null;
			case "script": return t = n.async, n = n.src, typeof n == "string" && t && typeof t != "function" && typeof t != "symbol" ? (n = Qm(n), t = Wt(a).hoistableScripts, r = t.get(n), r || (r = {
				type: "script",
				instance: null,
				count: 0,
				state: null
			}, t.set(n, r)), r) : {
				type: "void",
				instance: null,
				count: 0,
				state: null
			};
			default: throw Error(i(444, e));
		}
	}
	function Jm(e) {
		return "href=\"" + fn(e) + "\"";
	}
	function Ym(e) {
		return "link[rel=\"stylesheet\"][" + e + "]";
	}
	function Xm(e) {
		return E({}, e, {
			"data-precedence": e.precedence,
			precedence: null
		});
	}
	function Zm(e, t, n, r) {
		if (t = e.querySelector("link[rel=\"preload\"][as=\"style\"][" + t + "]")) {
			if (!0 !== t[zt]) {
				r.loading = 1;
				return;
			}
		} else t = e.createElement("link"), t[zt] = !0, t.onload = t.onerror = Kt.bind(null, t), _p(t, "link", n), Gt(t), e.head.appendChild(t);
		r.preload = t, t.addEventListener("load", function() {
			return r.loading |= 1;
		}), t.addEventListener("error", function() {
			return r.loading |= 2;
		});
	}
	function Qm(e) {
		return "[src=\"" + fn(e) + "\"]";
	}
	function $m(e) {
		return "script[async]" + e;
	}
	function B(e, t, n) {
		if (t.count++, t.instance === null) switch (t.type) {
			case "style":
				var r = e.querySelector("style[data-href~=\"" + fn(n.href) + "\"]");
				if (r) return t.instance = r, Gt(r), r;
				var a = E({}, n, {
					"data-href": n.href,
					"data-precedence": n.precedence,
					href: null,
					precedence: null
				});
				return r = (e.ownerDocument || e).createElement("style"), Gt(r), _p(r, "style", a), eh(r, n.precedence, e), t.instance = r;
			case "stylesheet":
				a = Jm(n.href);
				var o = e.querySelector(Ym(a));
				if (o) return t.state.loading |= 4, t.instance = o, Gt(o), o;
				r = Xm(n), (a = Nm.get(a)) && th(r, a), o = (e.ownerDocument || e).createElement("link"), Gt(o);
				var s = o;
				return s._p = new Promise(function(e, t) {
					s.onload = e, s.onerror = t;
				}), _p(o, "link", r), t.state.loading |= 4, eh(o, n.precedence, e), t.instance = o;
			case "script": return o = Qm(n.src), (a = e.querySelector($m(o))) ? (t.instance = a, Gt(a), a) : (r = n, (a = Nm.get(o)) && (r = E({}, n), nh(r, a)), e = e.ownerDocument || e, a = e.createElement("script"), Gt(a), _p(a, "link", r), e.head.appendChild(a), t.instance = a);
			case "void": return null;
			default: throw Error(i(443, t.type));
		}
		else t.type === "stylesheet" && !(t.state.loading & 4) && (r = t.instance, t.state.loading |= 4, eh(r, n.precedence, e));
		return t.instance;
	}
	function eh(e, t, n) {
		for (var r = n.querySelectorAll("link[rel=\"stylesheet\"][data-precedence],style[data-precedence]"), i = r.length ? r[r.length - 1] : null, a = i, o = 0; o < r.length; o++) {
			var s = r[o];
			if (s.dataset.precedence === t) a = s;
			else if (a !== i) break;
		}
		a ? a.parentNode.insertBefore(e, a.nextSibling) : (t = n.nodeType === 9 ? n.head : n, t.insertBefore(e, t.firstChild));
	}
	function th(e, t) {
		e.crossOrigin ??= t.crossOrigin, e.referrerPolicy ??= t.referrerPolicy, e.title ??= t.title;
	}
	function nh(e, t) {
		e.crossOrigin ??= t.crossOrigin, e.referrerPolicy ??= t.referrerPolicy, e.integrity ??= t.integrity;
	}
	var rh = null;
	function ih(e, t, n) {
		if (rh === null) {
			var r = /* @__PURE__ */ new Map(), i = rh = /* @__PURE__ */ new Map();
			i.set(n, r);
		} else i = rh, r = i.get(n), r || (r = /* @__PURE__ */ new Map(), i.set(n, r));
		if (r.has(e)) return r;
		for (r.set(e, null), n = n.getElementsByTagName(e), i = 0; i < n.length; i++) {
			var a = n[i];
			if (!(a[Rt] || a[jt] || e === "link" && a.getAttribute("rel") === "stylesheet") && a.namespaceURI !== "http://www.w3.org/2000/svg") {
				var o = a.getAttribute(t) || "";
				o = e + o;
				var s = r.get(o);
				s ? s.push(a) : r.set(o, [a]);
			}
		}
		return r;
	}
	function ah(e, t, n) {
		e = e.ownerDocument || e, e.head.insertBefore(n, t === "title" ? e.querySelector("head > title") : null);
	}
	function oh(e, t, n) {
		if (n === 1 || t.itemProp != null) return !1;
		switch (e) {
			case "meta":
			case "title": return !0;
			case "style":
				if (typeof t.precedence != "string" || typeof t.href != "string" || t.href === "") break;
				return !0;
			case "link":
				if (typeof t.rel != "string" || typeof t.href != "string" || t.href === "" || t.onLoad || t.onError) break;
				switch (t.rel) {
					case "stylesheet": return e = t.disabled, typeof t.precedence == "string" && e == null;
					default: return !0;
				}
			case "script": if (t.async && typeof t.async != "function" && typeof t.async != "symbol" && !t.onLoad && !t.onError && t.src && typeof t.src == "string") return !0;
		}
		return !1;
	}
	function sh(e, t) {
		return e === "img" && t.src != null && t.src !== "" && t.onLoad == null && t.loading !== "lazy";
	}
	function ch(e) {
		return !(e.type === "stylesheet" && !(e.state.loading & 3));
	}
	function lh(e) {
		return (e.width || 100) * (e.height || 100) * (typeof devicePixelRatio == "number" ? devicePixelRatio : 1) * .25;
	}
	function uh(e, t) {
		typeof t.decode == "function" && (e.imgCount++, t.complete || (e.imgBytes += lh(t), e.suspenseyImages.push(t)), e = gh.bind(e), t.decode().then(e, e));
	}
	function dh(e, t, n, r) {
		if (n.type === "stylesheet" && (typeof r.media != "string" || !1 !== matchMedia(r.media).matches) && !(n.state.loading & 4)) {
			if (n.instance === null) {
				var i = Jm(r.href), a = t.querySelector(Ym(i));
				if (a) {
					t = a._p, typeof t == "object" && t && typeof t.then == "function" && (e.count++, e = hh.bind(e), t.then(e, e)), n.state.loading |= 4, n.instance = a, Gt(a);
					return;
				}
				a = t.ownerDocument || t, r = Xm(r), (i = Nm.get(i)) && th(r, i), a = a.createElement("link"), Gt(a);
				var o = a;
				o._p = new Promise(function(e, t) {
					o.onload = e, o.onerror = t;
				}), _p(a, "link", r), n.instance = a;
			}
			e.stylesheets === null && (e.stylesheets = /* @__PURE__ */ new Map()), e.stylesheets.set(n, t), (t = n.state.preload) && !(n.state.loading & 3) && (e.count++, n = hh.bind(e), t.addEventListener("load", n), t.addEventListener("error", n));
		}
	}
	var fh = 0;
	function ph(e, t) {
		return e.stylesheets && e.count === 0 && vh(e, e.stylesheets), 0 < e.count || 0 < e.imgCount ? function(n) {
			var r = setTimeout(function() {
				if (e.stylesheets && vh(e, e.stylesheets), e.unsuspend) {
					var t = e.unsuspend;
					e.unsuspend = null, t();
				}
			}, 6e4 + t);
			0 < e.imgBytes && fh === 0 && (fh = 62500 * xp());
			var i = setTimeout(function() {
				if (e.waitingForImages = !1, e.count === 0 && (e.stylesheets && vh(e, e.stylesheets), e.unsuspend)) {
					var t = e.unsuspend;
					e.unsuspend = null, t();
				}
			}, (e.imgBytes > fh ? 50 : 800) + t);
			return e.unsuspend = n, function() {
				e.unsuspend = null, clearTimeout(r), clearTimeout(i);
			};
		} : null;
	}
	function mh(e) {
		if (e.count === 0 && (e.imgCount === 0 || !e.waitingForImages)) {
			if (e.stylesheets) vh(e, e.stylesheets);
			else if (e.unsuspend) {
				var t = e.unsuspend;
				e.unsuspend = null, t();
			}
		}
	}
	function hh() {
		this.count--, mh(this);
	}
	function gh() {
		this.imgCount--, mh(this);
	}
	var _h = null;
	function vh(e, t) {
		e.stylesheets = null, e.unsuspend !== null && (e.count++, _h = /* @__PURE__ */ new Map(), t.forEach(yh, e), _h = null, hh.call(e));
	}
	function yh(e, t) {
		if (!(t.state.loading & 4)) {
			var n = _h.get(e);
			if (n) var r = n.get(null);
			else {
				n = /* @__PURE__ */ new Map(), _h.set(e, n);
				for (var i = e.querySelectorAll("link[data-precedence],style[data-precedence]"), a = 0; a < i.length; a++) {
					var o = i[a];
					(o.nodeName === "LINK" || o.getAttribute("media") !== "not all") && (n.set(o.dataset.precedence, o), r = o);
				}
				r && n.set(null, r);
			}
			i = t.instance, o = i.getAttribute("data-precedence"), a = n.get(o) || r, a === r && n.set(null, i), n.set(o, i), this.count++, r = hh.bind(this), i.addEventListener("load", r), i.addEventListener("error", r), a ? a.parentNode.insertBefore(i, a.nextSibling) : (e = e.nodeType === 9 ? e.head : e, e.insertBefore(i, e.firstChild)), t.state.loading |= 4;
		}
	}
	var bh = {
		$$typeof: oe,
		Provider: null,
		Consumer: null,
		_currentValue: Ce,
		_currentValue2: Ce,
		_threadCount: 0
	};
	function xh(e, t, n, r, i, a, o, s, c) {
		this.tag = 1, this.containerInfo = e, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = bt(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = bt(0), this.hiddenUpdates = bt(null), this.identifierPrefix = r, this.onUncaughtError = i, this.onCaughtError = a, this.onRecoverableError = o, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = c, this.transitionTypes = null, this.incompleteTransitions = /* @__PURE__ */ new Map();
	}
	function Sh(e, t, n, r, i, a, o, s, c, l, u, d) {
		return e = new xh(e, t, n, o, c, l, u, d, s), t = 1, !0 === a && (t |= 24), a = zi(3, null, null, t), e.current = a, a.stateNode = e, t = Ia(), t.refCount++, e.pooledCache = t, t.refCount++, a.memoizedState = {
			element: r,
			isDehydrated: n,
			cache: t
		}, yo(a), e;
	}
	function Ch(e) {
		return e ? (e = Li, e) : Li;
	}
	function wh(e, t, n, r, i, a) {
		i = Ch(i), r.context === null ? r.context = i : r.pendingContext = i, r = xo(t), r.payload = { element: n }, a = a === void 0 ? null : a, a !== null && (r.callback = a), n = So(e, r, t), n !== null && (qd(n, e, t), Co(n, e, t));
	}
	function Th(e, t) {
		if (e = e.memoizedState, e !== null && e.dehydrated !== null) {
			var n = e.retryLane;
			e.retryLane = n !== 0 && n < t ? n : t;
		}
	}
	function Eh(e, t) {
		Th(e, t), (e = e.alternate) && Th(e, t);
	}
	function Dh(e) {
		if (e.tag === 13 || e.tag === 31) {
			var t = Pi(e, 67108864);
			t !== null && qd(t, e, 67108864), Eh(e, 67108864);
		}
	}
	function Oh(e) {
		if (e.tag === 13 || e.tag === 31) {
			var t = Wd();
			t = Et(t);
			var n = Pi(e, t);
			n !== null && qd(n, e, t), Eh(e, t);
		}
	}
	var kh = !0;
	function Ah(e, t, n, r) {
		var i = k.T;
		k.T = null;
		var a = Se.p;
		try {
			Se.p = 2, Mh(e, t, n, r);
		} finally {
			Se.p = a, k.T = i;
		}
	}
	function jh(e, t, n, r) {
		var i = k.T;
		k.T = null;
		var a = Se.p;
		try {
			Se.p = 8, Mh(e, t, n, r);
		} finally {
			Se.p = a, k.T = i;
		}
	}
	function Mh(e, t, n, r) {
		if (kh) {
			var i = Nh(r);
			if (i === null) op(e, t, r, Ph, n), V(e, r);
			else if (H(i, e, t, n, r)) r.stopPropagation();
			else if (V(e, r), t & 4 && -1 < Wh.indexOf(e)) {
				for (; i !== null;) {
					var a = Ht(i);
					if (a !== null) switch (a.tag) {
						case 3:
							if (a = a.stateNode, a.current.memoizedState.isDehydrated) {
								var o = mt(a.pendingLanes);
								if (o !== 0) {
									var s = a;
									for (s.pendingLanes |= 2, s.entangledLanes |= 2; o;) {
										var c = 1 << 31 - st(o);
										s.entanglements[1] |= c, o &= ~c;
									}
									Bf(a), !(cd & 6) && (kd = Ye() + 500, Vf(0, !1));
								}
							}
							break;
						case 31:
						case 13: s = Pi(a, 2), s !== null && qd(s, a, 2), Qd(), Eh(a, 2);
					}
					if (a = Nh(r), a === null && op(e, t, r, Ph, n), a === i) break;
					i = a;
				}
				i !== null && r.stopPropagation();
			} else op(e, t, r, null, n);
		}
	}
	function Nh(e) {
		return e = kn(e), Fh(e);
	}
	var Ph = null;
	function Fh(e) {
		if (Ph = null, e = Vt(e), e !== null) {
			var t = o(e);
			if (t === null) e = null;
			else {
				var n = t.tag;
				if (n === 13) {
					if (e = s(t), e !== null) return e;
					e = null;
				} else if (n === 31) {
					if (e = c(t), e !== null) return e;
					e = null;
				} else if (n === 3) {
					if (t.stateNode.current.memoizedState.isDehydrated) return t.tag === 3 ? t.stateNode.containerInfo : null;
					e = null;
				} else t !== e && (e = null);
			}
		}
		return Ph = e, null;
	}
	function Ih(e) {
		switch (e) {
			case "beforetoggle":
			case "cancel":
			case "click":
			case "close":
			case "contextmenu":
			case "copy":
			case "cut":
			case "auxclick":
			case "dblclick":
			case "dragend":
			case "dragstart":
			case "drop":
			case "focusin":
			case "focusout":
			case "input":
			case "invalid":
			case "keydown":
			case "keypress":
			case "keyup":
			case "mousedown":
			case "mouseup":
			case "paste":
			case "pause":
			case "play":
			case "pointercancel":
			case "pointerdown":
			case "pointerup":
			case "ratechange":
			case "reset":
			case "seeked":
			case "submit":
			case "toggle":
			case "touchcancel":
			case "touchend":
			case "touchstart":
			case "volumechange":
			case "change":
			case "selectionchange":
			case "textInput":
			case "compositionstart":
			case "compositionend":
			case "compositionupdate":
			case "beforeblur":
			case "afterblur":
			case "beforeinput":
			case "blur":
			case "fullscreenchange":
			case "fullscreenerror":
			case "focus":
			case "hashchange":
			case "popstate":
			case "select":
			case "selectstart": return 2;
			case "drag":
			case "dragenter":
			case "dragexit":
			case "dragleave":
			case "dragover":
			case "mousemove":
			case "mouseout":
			case "mouseover":
			case "pointermove":
			case "pointerout":
			case "pointerover":
			case "resize":
			case "scroll":
			case "touchmove":
			case "wheel":
			case "mouseenter":
			case "mouseleave":
			case "pointerenter":
			case "pointerleave": return 8;
			case "message": switch (Xe()) {
				case Ze: return 2;
				case Qe: return 8;
				case $e:
				case et: return 32;
				case tt: return 268435456;
				default: return 32;
			}
			default: return 32;
		}
	}
	var Lh = !1, Rh = null, zh = null, Bh = null, Vh = /* @__PURE__ */ new Map(), Hh = /* @__PURE__ */ new Map(), Uh = [], Wh = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");
	function V(e, t) {
		switch (e) {
			case "focusin":
			case "focusout":
				Rh = null;
				break;
			case "dragenter":
			case "dragleave":
				zh = null;
				break;
			case "mouseover":
			case "mouseout":
				Bh = null;
				break;
			case "pointerover":
			case "pointerout":
				Vh.delete(t.pointerId);
				break;
			case "gotpointercapture":
			case "lostpointercapture": Hh.delete(t.pointerId);
		}
	}
	function Gh(e, t, n, r, i, a) {
		return e === null || e.nativeEvent !== a ? (e = {
			blockedOn: t,
			domEventName: n,
			eventSystemFlags: r,
			nativeEvent: a,
			targetContainers: [i]
		}, t !== null && (t = Ht(t), t !== null && Dh(t)), e) : (e.eventSystemFlags |= r, t = e.targetContainers, i !== null && t.indexOf(i) === -1 && t.push(i), e);
	}
	function H(e, t, n, r, i) {
		switch (t) {
			case "focusin": return Rh = Gh(Rh, e, t, n, r, i), !0;
			case "dragenter": return zh = Gh(zh, e, t, n, r, i), !0;
			case "mouseover": return Bh = Gh(Bh, e, t, n, r, i), !0;
			case "pointerover":
				var a = i.pointerId;
				return Vh.set(a, Gh(Vh.get(a) || null, e, t, n, r, i)), !0;
			case "gotpointercapture": return a = i.pointerId, Hh.set(a, Gh(Hh.get(a) || null, e, t, n, r, i)), !0;
		}
		return !1;
	}
	function U(e) {
		var t = Vt(e.target);
		if (t !== null) {
			var n = o(t);
			if (n !== null) {
				if (t = n.tag, t === 13) {
					if (t = s(n), t !== null) {
						e.blockedOn = t, kt(e.priority, function() {
							Oh(n);
						});
						return;
					}
				} else if (t === 31) {
					if (t = c(n), t !== null) {
						e.blockedOn = t, kt(e.priority, function() {
							Oh(n);
						});
						return;
					}
				} else if (t === 3 && n.stateNode.current.memoizedState.isDehydrated) {
					e.blockedOn = n.tag === 3 ? n.stateNode.containerInfo : null;
					return;
				}
			}
		}
		e.blockedOn = null;
	}
	function Kh(e) {
		if (e.blockedOn !== null) return !1;
		for (var t = e.targetContainers; 0 < t.length;) {
			var n = Nh(e.nativeEvent);
			if (n === null) {
				n = e.nativeEvent;
				var r = new n.constructor(n.type, n);
				On = r, n.target.dispatchEvent(r), On = null;
			} else return t = Ht(n), t !== null && Dh(t), e.blockedOn = n, !1;
			t.shift();
		}
		return !0;
	}
	function qh(e, t, n) {
		Kh(e) && n.delete(t);
	}
	function W() {
		Lh = !1, Rh !== null && Kh(Rh) && (Rh = null), zh !== null && Kh(zh) && (zh = null), Bh !== null && Kh(Bh) && (Bh = null), Vh.forEach(qh), Hh.forEach(qh);
	}
	function Jh(e, n) {
		e.blockedOn === n && (e.blockedOn = null, Lh || (Lh = !0, t.unstable_scheduleCallback(t.unstable_NormalPriority, W)));
	}
	var Yh = null;
	function Xh(e) {
		Yh !== e && (Yh = e, t.unstable_scheduleCallback(t.unstable_NormalPriority, function() {
			Yh === e && (Yh = null);
			for (var t = 0; t < e.length; t += 3) {
				var n = e[t], r = e[t + 1], i = e[t + 2];
				if (typeof r != "function") {
					if (Fh(r || n) === null) continue;
					break;
				}
				var a = Ht(n);
				a !== null && (e.splice(t, 3), t -= 3, oc(a, {
					pending: !0,
					data: i,
					method: n.method,
					action: r
				}, r, i));
			}
		}));
	}
	function Zh(e) {
		function t(t) {
			return Jh(t, e);
		}
		Rh !== null && Jh(Rh, e), zh !== null && Jh(zh, e), Bh !== null && Jh(Bh, e), Vh.forEach(t), Hh.forEach(t);
		for (var n = 0; n < Uh.length; n++) {
			var r = Uh[n];
			r.blockedOn === e && (r.blockedOn = null);
		}
		for (; 0 < Uh.length && (n = Uh[0], n.blockedOn === null);) U(n), n.blockedOn === null && Uh.shift();
		if (n = (e.ownerDocument || e).$$reactFormReplay, n != null) for (r = 0; r < n.length; r += 3) {
			var i = n[r], a = n[r + 1], o = i[Mt] || null;
			if (typeof a == "function") o || Xh(n);
			else if (o) {
				var s = null;
				if (a && a.hasAttribute("formAction")) {
					if (i = a, o = a[Mt] || null) s = o.formAction;
					else if (Fh(i) !== null) continue;
				} else s = o.action;
				typeof s == "function" ? n[r + 1] = s : (n.splice(r, 3), r -= 3), Xh(n);
			}
		}
	}
	function Qh() {
		function e(e) {
			e.canIntercept && e.info === "react-transition" && e.intercept({
				handler: function() {
					return new Promise(function(e) {
						return i = e;
					});
				},
				focusReset: "manual",
				scroll: "manual"
			});
		}
		function t() {
			i !== null && (i(), i = null), r || setTimeout(n, 20);
		}
		function n() {
			if (!r && !navigation.transition) {
				var e = navigation.currentEntry;
				e && e.url != null && navigation.navigate(e.url, {
					state: e.getState(),
					info: "react-transition",
					history: "replace"
				});
			}
		}
		if (typeof navigation == "object") {
			var r = !1, i = null;
			return navigation.addEventListener("navigate", e), navigation.addEventListener("navigatesuccess", t), navigation.addEventListener("navigateerror", t), setTimeout(n, 100), function() {
				r = !0, navigation.removeEventListener("navigate", e), navigation.removeEventListener("navigatesuccess", t), navigation.removeEventListener("navigateerror", t), i !== null && (i(), i = null);
			};
		}
	}
	function $h(e) {
		this._internalRoot = e;
	}
	eg.prototype.render = $h.prototype.render = function(e) {
		var t = this._internalRoot;
		if (t === null) throw Error(i(409));
		var n = t.current;
		wh(n, Wd(), e, t, null, null);
	}, eg.prototype.unmount = $h.prototype.unmount = function() {
		var e = this._internalRoot;
		if (e !== null) {
			this._internalRoot = null;
			var t = e.containerInfo;
			wh(e.current, 2, null, e, null, null), Qd(), t[Nt] = null;
		}
	};
	function eg(e) {
		this._internalRoot = e;
	}
	eg.prototype.unstable_scheduleHydration = function(e) {
		if (e) {
			var t = Ot();
			e = {
				blockedOn: null,
				target: e,
				priority: t
			};
			for (var n = 0; n < Uh.length && t !== 0 && t < Uh[n].priority; n++);
			Uh.splice(n, 0, e), n === 0 && U(e);
		}
	};
	var tg = n.version;
	if (tg !== "19.3.0") throw Error(i(527, tg, "19.3.0"));
	Se.findDOMNode = function(e) {
		var t = e._reactInternals;
		if (t === void 0) throw typeof e.render == "function" ? Error(i(188)) : (e = Object.keys(e).join(","), Error(i(268, e)));
		return e = d(t), e = e === null ? null : p(e), e = e === null ? null : e.stateNode, e;
	};
	var ng = {
		bundleType: 0,
		version: "19.3.0",
		rendererPackageName: "react-dom",
		currentDispatcherRef: k,
		reconcilerVersion: "19.3.0"
	};
	if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
		var rg = __REACT_DEVTOOLS_GLOBAL_HOOK__;
		if (!rg.isDisabled && rg.supportsFiber) try {
			it = rg.inject(ng), at = rg;
		} catch {}
	}
	e.createRoot = function(e, t) {
		if (!a(e)) throw Error(i(299));
		var n = !1, r = "", o = kc, s = Ac, c = jc;
		return t != null && (!0 === t.unstable_strictMode && (n = !0), t.identifierPrefix !== void 0 && (r = t.identifierPrefix), t.onUncaughtError !== void 0 && (o = t.onUncaughtError), t.onCaughtError !== void 0 && (s = t.onCaughtError), t.onRecoverableError !== void 0 && (c = t.onRecoverableError)), t = Sh(e, 1, !1, null, null, n, r, null, o, s, c, Qh), e[Nt] = t.current, ip(e), new $h(t);
	};
})), g = /* @__PURE__ */ o(((e, t) => {
	function n() {
		if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u" && typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE == "function") try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
		} catch (e) {
			console.error(e);
		}
	}
	n(), t.exports = h();
})), _ = /* @__PURE__ */ c(u(), 1), v = g();
function y(e, t) {
	let n = t && t.cache ? t.cache : D, r = t && t.serializer ? t.serializer : E;
	return (t && t.strategy ? t.strategy : w)(e, {
		cache: n,
		serializer: r
	});
}
function b(e) {
	return e == null || typeof e == "number" || typeof e == "boolean";
}
function x(e, t, n, r) {
	let i = b(r) ? r : n(r), a = t.get(i);
	return a === void 0 && (a = e.call(this, r), t.set(i, a)), a;
}
function S(e, t, n) {
	let r = Array.prototype.slice.call(arguments, 3), i = n(r), a = t.get(i);
	return a === void 0 && (a = e.apply(this, r), t.set(i, a)), a;
}
function C(e, t, n, r, i) {
	return n.bind(t, e, r, i);
}
function w(e, t) {
	let n = e.length === 1 ? x : S;
	return C(e, this, n, t.cache.create(), t.serializer);
}
function T(e, t) {
	return C(e, this, S, t.cache.create(), t.serializer);
}
function ee(e, t) {
	return C(e, this, x, t.cache.create(), t.serializer);
}
var E = function() {
	return JSON.stringify(arguments);
}, te = class {
	constructor() {
		this.cache = Object.create(null);
	}
	get(e) {
		return this.cache[e];
	}
	set(e, t) {
		this.cache[e] = t;
	}
}, D = { create: function() {
	return new te();
} }, O = {
	variadic: T,
	monadic: ee
}, ne = /(?:[Eec]{1,6}|G{1,5}|[Qq]{1,5}|(?:[yYur]+|U{1,5})|[ML]{1,5}|d{1,2}|D{1,3}|F{1}|[abB]{1,5}|[hkHK]{1,2}|w{1,2}|W{1}|m{1,2}|s{1,2}|[zZOvVxX]{1,4})(?=([^']*'[^']*')*[^']*$)/g;
function re(e) {
	let t = {};
	return e.replace(ne, (e) => {
		let n = e.length;
		switch (e[0]) {
			case "G":
				t.era = n === 4 ? "long" : n === 5 ? "narrow" : "short";
				break;
			case "y":
				t.year = n === 2 ? "2-digit" : "numeric";
				break;
			case "Y":
			case "u":
			case "U":
			case "r": throw RangeError("`Y/u/U/r` (year) patterns are not supported, use `y` instead");
			case "q":
			case "Q": throw RangeError("`q/Q` (quarter) patterns are not supported");
			case "M":
			case "L":
				t.month = [
					"numeric",
					"2-digit",
					"short",
					"long",
					"narrow"
				][n - 1];
				break;
			case "w":
			case "W": throw RangeError("`w/W` (week) patterns are not supported");
			case "d":
				t.day = ["numeric", "2-digit"][n - 1];
				break;
			case "D":
			case "F":
			case "g": throw RangeError("`D/F/g` (day) patterns are not supported, use `d` instead");
			case "E":
				t.weekday = n === 4 ? "long" : n === 5 ? "narrow" : "short";
				break;
			case "e":
				if (n < 4) throw RangeError("`e..eee` (weekday) patterns are not supported");
				t.weekday = [
					"short",
					"long",
					"narrow",
					"short"
				][n - 3];
				break;
			case "c":
				if (n < 4) throw RangeError("`c..ccc` (weekday) patterns are not supported");
				t.weekday = [
					"short",
					"long",
					"narrow",
					"short"
				][n - 3];
				break;
			case "a":
				t.hour12 = !0;
				break;
			case "b":
			case "B": throw RangeError("`b/B` (period) patterns are not supported, use `a` instead");
			case "h":
				t.hourCycle = "h12", t.hour = ["numeric", "2-digit"][n - 1];
				break;
			case "H":
				t.hourCycle = "h23", t.hour = ["numeric", "2-digit"][n - 1];
				break;
			case "K":
				t.hourCycle = "h11", t.hour = ["numeric", "2-digit"][n - 1];
				break;
			case "k":
				t.hourCycle = "h24", t.hour = ["numeric", "2-digit"][n - 1];
				break;
			case "j":
			case "J":
			case "C": throw RangeError("`j/J/C` (hour) patterns are not supported, use `h/H/K/k` instead");
			case "m":
				t.minute = ["numeric", "2-digit"][n - 1];
				break;
			case "s":
				t.second = ["numeric", "2-digit"][n - 1];
				break;
			case "S":
			case "A": throw RangeError("`S/A` (second) patterns are not supported, use `s` instead");
			case "z":
				t.timeZoneName = n < 4 ? "short" : "long";
				break;
			case "Z":
			case "O":
			case "v":
			case "V":
			case "X":
			case "x": throw RangeError("`Z/O/v/V/X/x` (timeZone) patterns are not supported, use `z` instead");
		}
		return "";
	}), t;
}
var ie = /[\t-\r \x85\u200E\u200F\u2028\u2029]/i;
function ae(e) {
	if (e.length === 0) throw Error("Number skeleton cannot be empty");
	let t = e.split(ie).filter((e) => e.length > 0), n = [];
	for (let e of t) {
		let t = e.split("/");
		if (t.length === 0) throw Error("Invalid number skeleton");
		let [r, ...i] = t;
		for (let e of i) if (e.length === 0) throw Error("Invalid number skeleton");
		n.push({
			stem: r,
			options: i
		});
	}
	return n;
}
function oe(e) {
	return e.replace(/^(.*?)-/, "");
}
var se = /^\.(?:(0+)(\*)?|(#+)|(0+)(#+))$/g, ce = /^(@+)?(\+|#+)?[rs]?$/g, le = /(\*)(0+)|(#+)(0+)|(0+)/g, ue = /^(0+)$/;
function de(e) {
	let t = {};
	return e[e.length - 1] === "r" ? t.roundingPriority = "morePrecision" : e[e.length - 1] === "s" && (t.roundingPriority = "lessPrecision"), e.replace(ce, function(e, n, r) {
		return typeof r == "string" ? r === "+" ? t.minimumSignificantDigits = n.length : n[0] === "#" ? t.maximumSignificantDigits = n.length : (t.minimumSignificantDigits = n.length, t.maximumSignificantDigits = n.length + (typeof r == "string" ? r.length : 0)) : (t.minimumSignificantDigits = n.length, t.maximumSignificantDigits = n.length), "";
	}), t;
}
function fe(e) {
	switch (e) {
		case "sign-auto": return { signDisplay: "auto" };
		case "sign-accounting":
		case "()": return { currencySign: "accounting" };
		case "sign-always":
		case "+!": return { signDisplay: "always" };
		case "sign-accounting-always":
		case "()!": return {
			signDisplay: "always",
			currencySign: "accounting"
		};
		case "sign-except-zero":
		case "+?": return { signDisplay: "exceptZero" };
		case "sign-accounting-except-zero":
		case "()?": return {
			signDisplay: "exceptZero",
			currencySign: "accounting"
		};
		case "sign-never":
		case "+_": return { signDisplay: "never" };
	}
}
function pe(e) {
	let t;
	if (e[0] === "E" && e[1] === "E" ? (t = { notation: "engineering" }, e = e.slice(2)) : e[0] === "E" && (t = { notation: "scientific" }, e = e.slice(1)), t) {
		let n = e.slice(0, 2);
		if (n === "+!" ? (t.signDisplay = "always", e = e.slice(2)) : n === "+?" && (t.signDisplay = "exceptZero", e = e.slice(2)), !ue.test(e)) throw Error("Malformed concise eng/scientific notation");
		t.minimumIntegerDigits = e.length;
	}
	return t;
}
function me(e) {
	return fe(e) || {};
}
function he(e) {
	let t = {};
	for (let n of e) {
		switch (n.stem) {
			case "percent":
			case "%":
				t.style = "percent";
				continue;
			case "%x100":
				t.style = "percent", t.scale = 100;
				continue;
			case "currency":
				t.style = "currency", t.currency = n.options[0];
				continue;
			case "group-off":
			case ",_":
				t.useGrouping = !1;
				continue;
			case "precision-integer":
			case ".":
				t.maximumFractionDigits = 0;
				continue;
			case "measure-unit":
			case "unit":
				t.style = "unit", t.unit = oe(n.options[0]);
				continue;
			case "compact-short":
			case "K":
				t.notation = "compact", t.compactDisplay = "short";
				continue;
			case "compact-long":
			case "KK":
				t.notation = "compact", t.compactDisplay = "long";
				continue;
			case "scientific":
				t = {
					...t,
					notation: "scientific",
					...n.options.reduce((e, t) => ({
						...e,
						...me(t)
					}), {})
				};
				continue;
			case "engineering":
				t = {
					...t,
					notation: "engineering",
					...n.options.reduce((e, t) => ({
						...e,
						...me(t)
					}), {})
				};
				continue;
			case "notation-simple":
				t.notation = "standard";
				continue;
			case "unit-width-narrow":
				t.currencyDisplay = "narrowSymbol", t.unitDisplay = "narrow";
				continue;
			case "unit-width-short":
				t.currencyDisplay = "code", t.unitDisplay = "short";
				continue;
			case "unit-width-full-name":
				t.currencyDisplay = "name", t.unitDisplay = "long";
				continue;
			case "unit-width-iso-code":
				t.currencyDisplay = "symbol";
				continue;
			case "scale":
				t.scale = parseFloat(n.options[0]);
				continue;
			case "rounding-mode-floor":
				t.roundingMode = "floor";
				continue;
			case "rounding-mode-ceiling":
				t.roundingMode = "ceil";
				continue;
			case "rounding-mode-down":
				t.roundingMode = "trunc";
				continue;
			case "rounding-mode-up":
				t.roundingMode = "expand";
				continue;
			case "rounding-mode-half-even":
				t.roundingMode = "halfEven";
				continue;
			case "rounding-mode-half-down":
				t.roundingMode = "halfTrunc";
				continue;
			case "rounding-mode-half-up":
				t.roundingMode = "halfExpand";
				continue;
			case "integer-width":
				if (n.options.length > 1) throw RangeError("integer-width stems only accept a single optional option");
				n.options[0].replace(le, function(e, n, r, i, a, o) {
					if (n) t.minimumIntegerDigits = r.length;
					else if (i && a) throw Error("We currently do not support maximum integer digits");
					else if (o) throw Error("We currently do not support exact integer digits");
					return "";
				});
				continue;
		}
		if (ue.test(n.stem)) {
			t.minimumIntegerDigits = n.stem.length;
			continue;
		}
		if (se.test(n.stem)) {
			if (n.options.length > 1) throw RangeError("Fraction-precision stems only accept a single optional option");
			n.stem.replace(se, function(e, n, r, i, a, o) {
				return r === "*" ? t.minimumFractionDigits = n.length : i && i[0] === "#" ? t.maximumFractionDigits = i.length : a && o ? (t.minimumFractionDigits = a.length, t.maximumFractionDigits = a.length + o.length) : (t.minimumFractionDigits = n.length, t.maximumFractionDigits = n.length), "";
			});
			let e = n.options[0];
			e === "w" ? t = {
				...t,
				trailingZeroDisplay: "stripIfInteger"
			} : e && (t = {
				...t,
				...de(e)
			});
			continue;
		}
		if (ce.test(n.stem)) {
			t = {
				...t,
				...de(n.stem)
			};
			continue;
		}
		let e = fe(n.stem);
		e && (t = {
			...t,
			...e
		});
		let r = pe(n.stem);
		r && (t = {
			...t,
			...r
		});
	}
	return t;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/@formatjs/icu-messageformat-parser/index.js
var ge = /* @__PURE__ */ function(e) {
	return e[e.EXPECT_ARGUMENT_CLOSING_BRACE = 1] = "EXPECT_ARGUMENT_CLOSING_BRACE", e[e.EMPTY_ARGUMENT = 2] = "EMPTY_ARGUMENT", e[e.MALFORMED_ARGUMENT = 3] = "MALFORMED_ARGUMENT", e[e.EXPECT_ARGUMENT_TYPE = 4] = "EXPECT_ARGUMENT_TYPE", e[e.INVALID_ARGUMENT_TYPE = 5] = "INVALID_ARGUMENT_TYPE", e[e.EXPECT_ARGUMENT_STYLE = 6] = "EXPECT_ARGUMENT_STYLE", e[e.INVALID_NUMBER_SKELETON = 7] = "INVALID_NUMBER_SKELETON", e[e.INVALID_DATE_TIME_SKELETON = 8] = "INVALID_DATE_TIME_SKELETON", e[e.EXPECT_NUMBER_SKELETON = 9] = "EXPECT_NUMBER_SKELETON", e[e.EXPECT_DATE_TIME_SKELETON = 10] = "EXPECT_DATE_TIME_SKELETON", e[e.UNCLOSED_QUOTE_IN_ARGUMENT_STYLE = 11] = "UNCLOSED_QUOTE_IN_ARGUMENT_STYLE", e[e.EXPECT_SELECT_ARGUMENT_OPTIONS = 12] = "EXPECT_SELECT_ARGUMENT_OPTIONS", e[e.EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE = 13] = "EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE", e[e.INVALID_PLURAL_ARGUMENT_OFFSET_VALUE = 14] = "INVALID_PLURAL_ARGUMENT_OFFSET_VALUE", e[e.EXPECT_SELECT_ARGUMENT_SELECTOR = 15] = "EXPECT_SELECT_ARGUMENT_SELECTOR", e[e.EXPECT_PLURAL_ARGUMENT_SELECTOR = 16] = "EXPECT_PLURAL_ARGUMENT_SELECTOR", e[e.EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT = 17] = "EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT", e[e.EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT = 18] = "EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT", e[e.INVALID_PLURAL_ARGUMENT_SELECTOR = 19] = "INVALID_PLURAL_ARGUMENT_SELECTOR", e[e.DUPLICATE_PLURAL_ARGUMENT_SELECTOR = 20] = "DUPLICATE_PLURAL_ARGUMENT_SELECTOR", e[e.DUPLICATE_SELECT_ARGUMENT_SELECTOR = 21] = "DUPLICATE_SELECT_ARGUMENT_SELECTOR", e[e.MISSING_OTHER_CLAUSE = 22] = "MISSING_OTHER_CLAUSE", e[e.INVALID_TAG = 23] = "INVALID_TAG", e[e.INVALID_TAG_NAME = 25] = "INVALID_TAG_NAME", e[e.UNMATCHED_CLOSING_TAG = 26] = "UNMATCHED_CLOSING_TAG", e[e.UNCLOSED_TAG = 27] = "UNCLOSED_TAG", e;
}({}), _e = /* @__PURE__ */ function(e) {
	return e[e.literal = 0] = "literal", e[e.argument = 1] = "argument", e[e.number = 2] = "number", e[e.date = 3] = "date", e[e.time = 4] = "time", e[e.select = 5] = "select", e[e.plural = 6] = "plural", e[e.pound = 7] = "pound", e[e.tag = 8] = "tag", e;
}({});
function ve(e) {
	return e.type === 0;
}
function ye(e) {
	return e.type === 1;
}
function be(e) {
	return e.type === 2;
}
function xe(e) {
	return e.type === 3;
}
function k(e) {
	return e.type === 4;
}
function Se(e) {
	return e.type === 5;
}
function Ce(e) {
	return e.type === 6;
}
function we(e) {
	return e.type === 7;
}
function Te(e) {
	return e.type === 8;
}
function Ee(e) {
	return !!(e && typeof e == "object" && e.type === 0);
}
function De(e) {
	return !!(e && typeof e == "object" && e.type === 1);
}
var Oe = /[ \xA0\u1680\u2000-\u200A\u202F\u205F\u3000]/, ke = /([^\t-\r -\/:-@\[-\^`\{-~\x85\xA0-\xA7\xA9\xAB\xAC\xAE\xB0\xB1\xB6\xBB\xBF\xD7\xF7\u1680\u2000-\u200A\u2010-\u2029\u202F-\u203E\u2041-\u2053\u2055-\u205F\u2190-\u245F\u2500-\u2775\u2794-\u2BFF\u2E00-\u2E7F\u3000-\u3003\u3008-\u3020\u3030\uFD3E\uFD3F\uFE45\uFE46]*)/g, Ae = {
	"001": ["H", "h"],
	419: [
		"h",
		"H",
		"hB",
		"hb"
	],
	AC: [
		"H",
		"h",
		"hb",
		"hB"
	],
	AD: ["H", "hB"],
	AE: [
		"h",
		"hB",
		"hb",
		"H"
	],
	AF: [
		"H",
		"hb",
		"hB",
		"h"
	],
	AG: [
		"h",
		"hb",
		"H",
		"hB"
	],
	AI: [
		"H",
		"h",
		"hb",
		"hB"
	],
	AL: [
		"h",
		"H",
		"hB"
	],
	AM: ["H", "hB"],
	AO: ["H", "hB"],
	AR: [
		"h",
		"H",
		"hB",
		"hb"
	],
	AS: ["h", "H"],
	AT: ["H", "hB"],
	AU: [
		"h",
		"hb",
		"H",
		"hB"
	],
	AW: ["H", "hB"],
	AX: ["H"],
	AZ: [
		"H",
		"hB",
		"h"
	],
	BA: [
		"H",
		"hB",
		"h"
	],
	BB: [
		"h",
		"hb",
		"H",
		"hB"
	],
	BD: [
		"h",
		"hB",
		"H"
	],
	BE: ["H", "hB"],
	BF: ["H", "hB"],
	BG: [
		"H",
		"hB",
		"h"
	],
	BH: [
		"h",
		"hB",
		"hb",
		"H"
	],
	BI: ["H", "h"],
	BJ: ["H", "hB"],
	BL: ["H", "hB"],
	BM: [
		"h",
		"hb",
		"H",
		"hB"
	],
	BN: [
		"hb",
		"hB",
		"h",
		"H"
	],
	BO: [
		"h",
		"H",
		"hB",
		"hb"
	],
	BQ: ["H"],
	BR: ["H", "hB"],
	BS: [
		"h",
		"hb",
		"H",
		"hB"
	],
	BT: ["h", "H"],
	BW: [
		"H",
		"h",
		"hb",
		"hB"
	],
	BY: ["H", "h"],
	BZ: [
		"H",
		"h",
		"hb",
		"hB"
	],
	CA: [
		"h",
		"hb",
		"H",
		"hB"
	],
	CC: [
		"H",
		"h",
		"hb",
		"hB"
	],
	CD: ["hB", "H"],
	CF: [
		"H",
		"h",
		"hB"
	],
	CG: ["H", "hB"],
	CH: [
		"H",
		"hB",
		"h"
	],
	CI: ["H", "hB"],
	CK: [
		"H",
		"h",
		"hb",
		"hB"
	],
	CL: [
		"h",
		"H",
		"hB",
		"hb"
	],
	CM: [
		"H",
		"h",
		"hB"
	],
	CN: [
		"H",
		"hB",
		"hb",
		"h"
	],
	CO: [
		"h",
		"H",
		"hB",
		"hb"
	],
	CP: ["H"],
	CR: [
		"h",
		"H",
		"hB",
		"hb"
	],
	CU: [
		"h",
		"H",
		"hB",
		"hb"
	],
	CV: ["H", "hB"],
	CW: ["H", "hB"],
	CX: [
		"H",
		"h",
		"hb",
		"hB"
	],
	CY: [
		"h",
		"H",
		"hb",
		"hB"
	],
	CZ: ["H"],
	DE: ["H", "hB"],
	DG: [
		"H",
		"h",
		"hb",
		"hB"
	],
	DJ: ["h", "H"],
	DK: ["H"],
	DM: [
		"h",
		"hb",
		"H",
		"hB"
	],
	DO: [
		"h",
		"H",
		"hB",
		"hb"
	],
	DZ: [
		"h",
		"hB",
		"hb",
		"H"
	],
	EA: [
		"H",
		"h",
		"hB",
		"hb"
	],
	EC: [
		"h",
		"H",
		"hB",
		"hb"
	],
	EE: ["H", "hB"],
	EG: [
		"h",
		"hB",
		"hb",
		"H"
	],
	EH: [
		"h",
		"hB",
		"hb",
		"H"
	],
	ER: ["h", "H"],
	ES: [
		"H",
		"hB",
		"h",
		"hb"
	],
	ET: [
		"hB",
		"hb",
		"h",
		"H"
	],
	FI: ["H"],
	FJ: [
		"h",
		"hb",
		"H",
		"hB"
	],
	FK: [
		"H",
		"h",
		"hb",
		"hB"
	],
	FM: [
		"h",
		"hb",
		"H",
		"hB"
	],
	FO: ["H", "h"],
	FR: ["H", "hB"],
	GA: ["H", "hB"],
	GB: [
		"H",
		"h",
		"hb",
		"hB"
	],
	GD: [
		"h",
		"hb",
		"H",
		"hB"
	],
	GE: [
		"H",
		"hB",
		"h"
	],
	GF: ["H", "hB"],
	GG: [
		"H",
		"h",
		"hb",
		"hB"
	],
	GH: ["h", "H"],
	GI: [
		"H",
		"h",
		"hb",
		"hB"
	],
	GL: ["H", "h"],
	GM: [
		"h",
		"hb",
		"H",
		"hB"
	],
	GN: ["H", "hB"],
	GP: ["H", "hB"],
	GQ: [
		"H",
		"hB",
		"h",
		"hb"
	],
	GR: [
		"h",
		"H",
		"hb",
		"hB"
	],
	GS: [
		"H",
		"h",
		"hb",
		"hB"
	],
	GT: [
		"h",
		"H",
		"hB",
		"hb"
	],
	GU: [
		"h",
		"hb",
		"H",
		"hB"
	],
	GW: ["H", "hB"],
	GY: [
		"h",
		"hb",
		"H",
		"hB"
	],
	HK: [
		"h",
		"hB",
		"hb",
		"H"
	],
	HN: [
		"h",
		"H",
		"hB",
		"hb"
	],
	HR: ["H", "hB"],
	HU: ["H", "h"],
	IC: [
		"H",
		"h",
		"hB",
		"hb"
	],
	ID: ["H"],
	IE: [
		"H",
		"h",
		"hb",
		"hB"
	],
	IL: ["H", "hB"],
	IM: [
		"H",
		"h",
		"hb",
		"hB"
	],
	IN: ["h", "H"],
	IO: [
		"H",
		"h",
		"hb",
		"hB"
	],
	IQ: [
		"h",
		"hB",
		"hb",
		"H"
	],
	IR: ["hB", "H"],
	IS: ["H"],
	IT: ["H", "hB"],
	JE: [
		"H",
		"h",
		"hb",
		"hB"
	],
	JM: [
		"h",
		"hb",
		"H",
		"hB"
	],
	JO: [
		"h",
		"hB",
		"hb",
		"H"
	],
	JP: [
		"H",
		"K",
		"h"
	],
	KE: [
		"hB",
		"hb",
		"H",
		"h"
	],
	KG: [
		"H",
		"h",
		"hB",
		"hb"
	],
	KH: [
		"hB",
		"h",
		"H",
		"hb"
	],
	KI: [
		"h",
		"hb",
		"H",
		"hB"
	],
	KM: [
		"H",
		"h",
		"hB",
		"hb"
	],
	KN: [
		"h",
		"hb",
		"H",
		"hB"
	],
	KP: [
		"h",
		"H",
		"hB",
		"hb"
	],
	KR: [
		"h",
		"H",
		"hB",
		"hb"
	],
	KW: [
		"h",
		"hB",
		"hb",
		"H"
	],
	KY: [
		"h",
		"hb",
		"H",
		"hB"
	],
	KZ: ["H", "hB"],
	LA: [
		"H",
		"hb",
		"hB",
		"h"
	],
	LB: [
		"h",
		"hB",
		"hb",
		"H"
	],
	LC: [
		"h",
		"hb",
		"H",
		"hB"
	],
	LI: [
		"H",
		"hB",
		"h"
	],
	LK: [
		"H",
		"h",
		"hB",
		"hb"
	],
	LR: [
		"h",
		"hb",
		"H",
		"hB"
	],
	LS: ["h", "H"],
	LT: [
		"H",
		"h",
		"hb",
		"hB"
	],
	LU: [
		"H",
		"h",
		"hB"
	],
	LV: [
		"H",
		"hB",
		"hb",
		"h"
	],
	LY: [
		"h",
		"hB",
		"hb",
		"H"
	],
	MA: [
		"H",
		"h",
		"hB",
		"hb"
	],
	MC: ["H", "hB"],
	MD: ["H", "hB"],
	ME: [
		"H",
		"hB",
		"h"
	],
	MF: ["H", "hB"],
	MG: ["H", "h"],
	MH: [
		"h",
		"hb",
		"H",
		"hB"
	],
	MK: [
		"H",
		"h",
		"hb",
		"hB"
	],
	ML: ["H"],
	MM: [
		"hB",
		"hb",
		"H",
		"h"
	],
	MN: [
		"H",
		"h",
		"hb",
		"hB"
	],
	MO: [
		"h",
		"hB",
		"hb",
		"H"
	],
	MP: [
		"h",
		"hb",
		"H",
		"hB"
	],
	MQ: ["H", "hB"],
	MR: [
		"h",
		"hB",
		"hb",
		"H"
	],
	MS: [
		"H",
		"h",
		"hb",
		"hB"
	],
	MT: ["H", "h"],
	MU: ["H", "h"],
	MV: ["H", "h"],
	MW: [
		"h",
		"hb",
		"H",
		"hB"
	],
	MX: [
		"h",
		"H",
		"hB",
		"hb"
	],
	MY: [
		"hb",
		"hB",
		"h",
		"H"
	],
	MZ: ["H", "hB"],
	NA: [
		"h",
		"H",
		"hB",
		"hb"
	],
	NC: ["H", "hB"],
	NE: ["H"],
	NF: [
		"H",
		"h",
		"hb",
		"hB"
	],
	NG: [
		"H",
		"h",
		"hb",
		"hB"
	],
	NI: [
		"h",
		"H",
		"hB",
		"hb"
	],
	NL: ["H", "hB"],
	NO: ["H", "h"],
	NP: [
		"H",
		"h",
		"hB"
	],
	NR: [
		"H",
		"h",
		"hb",
		"hB"
	],
	NU: [
		"H",
		"h",
		"hb",
		"hB"
	],
	NZ: [
		"h",
		"hb",
		"H",
		"hB"
	],
	OM: [
		"h",
		"hB",
		"hb",
		"H"
	],
	PA: [
		"h",
		"H",
		"hB",
		"hb"
	],
	PE: [
		"h",
		"H",
		"hB",
		"hb"
	],
	PF: [
		"H",
		"h",
		"hB"
	],
	PG: ["h", "H"],
	PH: [
		"h",
		"hB",
		"hb",
		"H"
	],
	PK: [
		"h",
		"hB",
		"H"
	],
	PL: ["H", "h"],
	PM: ["H", "hB"],
	PN: [
		"H",
		"h",
		"hb",
		"hB"
	],
	PR: [
		"h",
		"H",
		"hB",
		"hb"
	],
	PS: [
		"h",
		"hB",
		"hb",
		"H"
	],
	PT: ["H", "hB"],
	PW: ["h", "H"],
	PY: [
		"h",
		"H",
		"hB",
		"hb"
	],
	QA: [
		"h",
		"hB",
		"hb",
		"H"
	],
	RE: ["H", "hB"],
	RO: ["H", "hB"],
	RS: [
		"H",
		"hB",
		"h"
	],
	RU: ["H"],
	RW: ["H", "h"],
	SA: [
		"h",
		"hB",
		"hb",
		"H"
	],
	SB: [
		"h",
		"hb",
		"H",
		"hB"
	],
	SC: [
		"H",
		"h",
		"hB"
	],
	SD: [
		"h",
		"hB",
		"hb",
		"H"
	],
	SE: ["H"],
	SG: [
		"h",
		"hb",
		"H",
		"hB"
	],
	SH: [
		"H",
		"h",
		"hb",
		"hB"
	],
	SI: ["H", "hB"],
	SJ: ["H"],
	SK: ["H"],
	SL: [
		"h",
		"hb",
		"H",
		"hB"
	],
	SM: [
		"H",
		"h",
		"hB"
	],
	SN: [
		"H",
		"h",
		"hB"
	],
	SO: ["h", "H"],
	SR: ["H", "hB"],
	SS: [
		"h",
		"hb",
		"H",
		"hB"
	],
	ST: ["H", "hB"],
	SV: [
		"h",
		"H",
		"hB",
		"hb"
	],
	SX: [
		"H",
		"h",
		"hb",
		"hB"
	],
	SY: [
		"h",
		"hB",
		"hb",
		"H"
	],
	SZ: [
		"h",
		"hb",
		"H",
		"hB"
	],
	TA: [
		"H",
		"h",
		"hb",
		"hB"
	],
	TC: [
		"h",
		"hb",
		"H",
		"hB"
	],
	TD: [
		"h",
		"H",
		"hB"
	],
	TF: [
		"H",
		"h",
		"hB"
	],
	TG: ["H", "hB"],
	TH: ["H", "h"],
	TJ: ["H", "h"],
	TL: [
		"H",
		"hB",
		"hb",
		"h"
	],
	TM: ["H", "h"],
	TN: [
		"h",
		"hB",
		"hb",
		"H"
	],
	TO: ["h", "H"],
	TR: ["H", "hB"],
	TT: [
		"h",
		"hb",
		"H",
		"hB"
	],
	TW: [
		"hB",
		"hb",
		"h",
		"H"
	],
	TZ: [
		"hB",
		"hb",
		"H",
		"h"
	],
	UA: [
		"H",
		"hB",
		"h"
	],
	UG: [
		"hB",
		"hb",
		"H",
		"h"
	],
	UM: [
		"h",
		"hb",
		"H",
		"hB"
	],
	US: [
		"h",
		"hb",
		"H",
		"hB"
	],
	UY: [
		"h",
		"H",
		"hB",
		"hb"
	],
	UZ: [
		"H",
		"hB",
		"h"
	],
	VA: [
		"H",
		"h",
		"hB"
	],
	VC: [
		"h",
		"hb",
		"H",
		"hB"
	],
	VE: [
		"h",
		"H",
		"hB",
		"hb"
	],
	VG: [
		"h",
		"hb",
		"H",
		"hB"
	],
	VI: [
		"h",
		"hb",
		"H",
		"hB"
	],
	VN: ["H", "h"],
	VU: ["h", "H"],
	WF: ["H", "hB"],
	WS: ["h", "H"],
	XK: [
		"H",
		"hB",
		"h"
	],
	YE: [
		"h",
		"hB",
		"hb",
		"H"
	],
	YT: ["H", "hB"],
	ZA: [
		"H",
		"h",
		"hb",
		"hB"
	],
	ZM: [
		"h",
		"hb",
		"H",
		"hB"
	],
	ZW: ["H", "h"],
	"af-ZA": [
		"H",
		"h",
		"hB",
		"hb"
	],
	"ar-001": [
		"h",
		"hB",
		"hb",
		"H"
	],
	"ca-ES": [
		"H",
		"h",
		"hB"
	],
	"en-001": [
		"h",
		"hb",
		"H",
		"hB"
	],
	"en-HK": [
		"h",
		"hb",
		"H",
		"hB"
	],
	"en-IL": [
		"H",
		"h",
		"hb",
		"hB"
	],
	"en-MY": [
		"h",
		"hb",
		"H",
		"hB"
	],
	"es-BR": [
		"H",
		"h",
		"hB",
		"hb"
	],
	"es-ES": [
		"H",
		"h",
		"hB",
		"hb"
	],
	"es-GQ": [
		"H",
		"h",
		"hB",
		"hb"
	],
	"fr-CA": [
		"H",
		"h",
		"hB"
	],
	"gl-ES": [
		"H",
		"h",
		"hB"
	],
	"gu-IN": [
		"hB",
		"hb",
		"h",
		"H"
	],
	"hi-IN": [
		"hB",
		"h",
		"H"
	],
	"it-CH": [
		"H",
		"h",
		"hB"
	],
	"it-IT": [
		"H",
		"h",
		"hB"
	],
	"kn-IN": [
		"hB",
		"h",
		"H"
	],
	"ku-SY": ["H", "hB"],
	"ml-IN": [
		"hB",
		"h",
		"H"
	],
	"mr-IN": [
		"hB",
		"hb",
		"h",
		"H"
	],
	"pa-IN": [
		"hB",
		"hb",
		"h",
		"H"
	],
	"ta-IN": [
		"hB",
		"h",
		"hb",
		"H"
	],
	"te-IN": [
		"hB",
		"h",
		"H"
	],
	"zu-ZA": [
		"H",
		"hB",
		"hb",
		"h"
	]
};
function je(e, t) {
	let n = "";
	for (let r = 0; r < e.length; r++) {
		let i = e.charAt(r);
		if (i === "j") {
			let a = 0;
			for (; r + 1 < e.length && e.charAt(r + 1) === i;) a++, r++;
			let o = 1 + (a & 1), s = a < 2 ? 1 : 3 + (a >> 1), c = Me(t);
			for ((c == "H" || c == "k") && (s = 0); s-- > 0;) n += "a";
			for (; o-- > 0;) n = c + n;
		} else n += i === "J" ? "H" : i;
	}
	return n;
}
function Me(e) {
	let t = e.hourCycle;
	if (t === void 0) {
		let n = e;
		t = n.getHourCycles?.()[0] ?? n.hourCycles?.[0];
	}
	if (t) switch (t) {
		case "h24": return "k";
		case "h23": return "H";
		case "h12": return "h";
		case "h11": return "K";
		default: throw Error("Invalid hourCycle");
	}
	let n = e.language, r;
	return n !== "root" && (r = e.maximize().region), (Ae[`${n}-${r}`] || Ae[r || ""] || Ae[n || ""] || Ae[`${n}-001`] || Ae["001"])[0].charAt(0);
}
var Ne = RegExp(`^${Oe.source}*`), Pe = RegExp(`${Oe.source}*$`);
function Fe(e, t) {
	return {
		start: e,
		end: t
	};
}
var Ie = !!Object.fromEntries, Le = !!String.prototype.trimStart, Re = !!String.prototype.trimEnd, ze = Ie ? Object.fromEntries : function(e) {
	let t = {};
	for (let [n, r] of e) t[n] = r;
	return t;
}, Be = Le ? function(e) {
	return e.trimStart();
} : function(e) {
	return e.replace(Ne, "");
}, Ve = Re ? function(e) {
	return e.trimEnd();
} : function(e) {
	return e.replace(Pe, "");
}, He = Ue();
function Ue() {
	try {
		let e = /* @__PURE__ */ RegExp("([^\\p{White_Space}\\p{Pattern_Syntax}]*)", "yu");
		if (e.exec("a ")?.[1] === "a") return e;
	} catch {}
	return ke;
}
function We(e, t) {
	return He.lastIndex = t, He.exec(e)[1] ?? "";
}
function Ge(e) {
	if (e.length === 0) return null;
	let t = 1, n = 1;
	for (let r = 0; r < e.length;) {
		let i = e.charCodeAt(r);
		switch (i) {
			case 35:
			case 39:
			case 60:
			case 123:
			case 125: return null;
		}
		if (i === 10) t++, n = 1, r++;
		else if (n++, i >= 55296 && i <= 56319 && r + 1 < e.length) {
			let t = e.charCodeAt(r + 1);
			r += t >= 56320 && t <= 57343 ? 2 : 1;
		} else r++;
	}
	return {
		offset: e.length,
		line: t,
		column: n
	};
}
var Ke = class {
	constructor(e, t = {}) {
		this.message = e, this.position = {
			offset: 0,
			line: 1,
			column: 1
		}, this.ignoreTag = !!t.ignoreTag, this.locale = t.locale, this.requiresOtherClause = !!t.requiresOtherClause, this.shouldParseSkeletons = !!t.shouldParseSkeletons;
	}
	parse() {
		if (this.offset() !== 0) throw Error("parser can only be used once");
		if (this.message.length > 0) {
			let e = this.message.charCodeAt(0);
			if (e !== 35 && e !== 39 && e !== 60 && e !== 123 && e !== 125) {
				let e = Ge(this.message);
				if (e) {
					let t = this.clonePosition();
					return this.position = e, {
						val: [{
							type: 0,
							value: this.message,
							location: Fe(t, this.clonePosition())
						}],
						err: null
					};
				}
			}
		}
		return this.parseMessage(0, "", !1);
	}
	parseMessage(e, t, n) {
		let r = [];
		for (; !this.isEOF();) {
			let i = this.char();
			if (i === 123) {
				let t = this.parseArgument(e, n);
				if (t.err) return t;
				r.push(t.val);
			} else if (i === 125 && e > 0) break;
			else if (i === 35 && (t === "plural" || t === "selectordinal")) {
				let e = this.clonePosition();
				this.bump(), r.push({
					type: 7,
					location: Fe(e, this.clonePosition())
				});
			} else if (i === 60 && !this.ignoreTag && this.peek() === 47) {
				if (n) break;
				return this.error(26, Fe(this.clonePosition(), this.clonePosition()));
			} else if (i === 60 && !this.ignoreTag && qe(this.peek() || 0)) {
				let n = this.parseTag(e, t);
				if (n.err) return n;
				r.push(n.val);
			} else {
				let n = this.parseLiteral(e, t);
				if (n.err) return n;
				r.push(n.val);
			}
		}
		return {
			val: r,
			err: null
		};
	}
	parseTag(e, t) {
		let n = this.clonePosition();
		this.bump();
		let r = this.parseTagName();
		if (this.bumpSpace(), this.bumpIf("/>")) return {
			val: {
				type: 0,
				value: `<${r}/>`,
				location: Fe(n, this.clonePosition())
			},
			err: null
		};
		if (this.bumpIf(">")) {
			let i = this.parseMessage(e + 1, t, !0);
			if (i.err) return i;
			let a = i.val, o = this.clonePosition();
			if (this.bumpIf("</")) {
				if (this.isEOF() || !qe(this.char())) return this.error(23, Fe(o, this.clonePosition()));
				let e = this.clonePosition();
				return r === this.parseTagName() ? (this.bumpSpace(), this.bumpIf(">") ? {
					val: {
						type: 8,
						value: r,
						children: a,
						location: Fe(n, this.clonePosition())
					},
					err: null
				} : this.error(23, Fe(o, this.clonePosition()))) : this.error(26, Fe(e, this.clonePosition()));
			}
			return this.error(27, Fe(n, this.clonePosition()));
		}
		return this.error(23, Fe(n, this.clonePosition()));
	}
	parseTagName() {
		let e = this.offset();
		for (this.bump(); !this.isEOF() && Ye(this.char());) this.bump();
		return this.message.slice(e, this.offset());
	}
	parseLiteral(e, t) {
		let n = this.clonePosition(), r = "";
		for (;;) {
			let n = this.tryParseQuote(t);
			if (n) {
				r += n;
				continue;
			}
			let i = this.tryParseUnquoted(e, t);
			if (i) {
				r += i;
				continue;
			}
			let a = this.tryParseLeftAngleBracket();
			if (a) {
				r += a;
				continue;
			}
			break;
		}
		let i = Fe(n, this.clonePosition());
		return {
			val: {
				type: 0,
				value: r,
				location: i
			},
			err: null
		};
	}
	tryParseLeftAngleBracket() {
		return !this.isEOF() && this.char() === 60 && (this.ignoreTag || !Je(this.peek() || 0)) ? (this.bump(), "<") : null;
	}
	tryParseQuote(e) {
		if (this.isEOF() || this.char() !== 39) return null;
		switch (this.peek()) {
			case 39: return this.bump(), this.bump(), "'";
			case 123:
			case 60:
			case 62:
			case 125: break;
			case 35:
				if (e === "plural" || e === "selectordinal") break;
				return null;
			default: return null;
		}
		this.bump();
		let t = [this.char()];
		for (this.bump(); !this.isEOF();) {
			let e = this.char();
			if (e === 39) {
				if (this.peek() === 39) t.push(39), this.bump();
				else {
					this.bump();
					break;
				}
			} else t.push(e);
			this.bump();
		}
		return String.fromCodePoint(...t);
	}
	tryParseUnquoted(e, t) {
		if (this.isEOF()) return null;
		let n = this.char();
		return n === 60 || n === 123 || n === 35 && (t === "plural" || t === "selectordinal") || n === 125 && e > 0 ? null : (this.bump(), String.fromCodePoint(n));
	}
	parseArgument(e, t) {
		let n = this.clonePosition();
		if (this.bump(), this.bumpSpace(), this.isEOF()) return this.error(1, Fe(n, this.clonePosition()));
		if (this.char() === 125) return this.bump(), this.error(2, Fe(n, this.clonePosition()));
		let r = this.parseIdentifierIfPossible().value;
		if (!r) return this.error(3, Fe(n, this.clonePosition()));
		if (this.bumpSpace(), this.isEOF()) return this.error(1, Fe(n, this.clonePosition()));
		switch (this.char()) {
			case 125: return this.bump(), {
				val: {
					type: 1,
					value: r,
					location: Fe(n, this.clonePosition())
				},
				err: null
			};
			case 44: return this.bump(), this.bumpSpace(), this.isEOF() ? this.error(1, Fe(n, this.clonePosition())) : this.parseArgumentOptions(e, t, r, n);
			default: return this.error(3, Fe(n, this.clonePosition()));
		}
	}
	parseIdentifierIfPossible() {
		let e = this.clonePosition(), t = this.offset(), n = We(this.message, t), r = t + n.length;
		return this.bumpTo(r), {
			value: n,
			location: Fe(e, this.clonePosition())
		};
	}
	parseArgumentOptions(e, t, n, r) {
		let i = this.clonePosition(), a = this.parseIdentifierIfPossible().value, o = this.clonePosition();
		switch (a) {
			case "": return this.error(4, Fe(i, o));
			case "number":
			case "date":
			case "time": {
				this.bumpSpace();
				let e = null;
				if (this.bumpIf(",")) {
					this.bumpSpace();
					let t = this.clonePosition(), n = this.parseSimpleArgStyleIfPossible();
					if (n.err) return n;
					let r = Ve(n.val);
					if (r.length === 0) return this.error(6, Fe(this.clonePosition(), this.clonePosition()));
					e = {
						style: r,
						styleLocation: Fe(t, this.clonePosition())
					};
				}
				let t = this.tryParseArgumentClose(r);
				if (t.err) return t;
				let i = Fe(r, this.clonePosition());
				if (e && e.style.startsWith("::")) {
					let t = Be(e.style.slice(2));
					if (a === "number") {
						let r = this.parseNumberSkeletonFromString(t, e.styleLocation);
						return r.err ? r : {
							val: {
								type: 2,
								value: n,
								location: i,
								style: r.val
							},
							err: null
						};
					}
					{
						if (t.length === 0) return this.error(10, i);
						let r = t;
						this.locale && (r = je(t, this.locale));
						let o = {
							type: 1,
							pattern: r,
							location: e.styleLocation,
							parsedOptions: this.shouldParseSkeletons ? re(r) : {}
						};
						return {
							val: {
								type: a === "date" ? 3 : 4,
								value: n,
								location: i,
								style: o
							},
							err: null
						};
					}
				}
				return {
					val: {
						type: a === "number" ? 2 : a === "date" ? 3 : 4,
						value: n,
						location: i,
						style: e?.style ?? null
					},
					err: null
				};
			}
			case "plural":
			case "selectordinal":
			case "select": {
				let i = this.clonePosition();
				if (this.bumpSpace(), !this.bumpIf(",")) return this.error(12, Fe(i, { ...i }));
				this.bumpSpace();
				let o = this.parseIdentifierIfPossible(), s = 0;
				if (a !== "select" && o.value === "offset") {
					if (!this.bumpIf(":")) return this.error(13, Fe(this.clonePosition(), this.clonePosition()));
					this.bumpSpace();
					let e = this.tryParseDecimalInteger(13, 14);
					if (e.err) return e;
					this.bumpSpace(), o = this.parseIdentifierIfPossible(), s = e.val;
				}
				let c = this.tryParsePluralOrSelectOptions(e, a, t, o);
				if (c.err) return c;
				let l = this.tryParseArgumentClose(r);
				if (l.err) return l;
				let u = Fe(r, this.clonePosition());
				return a === "select" ? {
					val: {
						type: 5,
						value: n,
						options: ze(c.val),
						location: u
					},
					err: null
				} : {
					val: {
						type: 6,
						value: n,
						options: ze(c.val),
						offset: s,
						pluralType: a === "plural" ? "cardinal" : "ordinal",
						location: u
					},
					err: null
				};
			}
			default: return this.error(5, Fe(i, o));
		}
	}
	tryParseArgumentClose(e) {
		return this.isEOF() || this.char() !== 125 ? this.error(1, Fe(e, this.clonePosition())) : (this.bump(), {
			val: !0,
			err: null
		});
	}
	parseSimpleArgStyleIfPossible() {
		let e = 0, t = this.clonePosition();
		for (; !this.isEOF();) switch (this.char()) {
			case 39: {
				this.bump();
				let e = this.clonePosition();
				if (!this.bumpUntil("'")) return this.error(11, Fe(e, this.clonePosition()));
				this.bump();
				break;
			}
			case 123:
				e += 1, this.bump();
				break;
			case 125:
				if (e > 0) --e;
				else return {
					val: this.message.slice(t.offset, this.offset()),
					err: null
				};
				break;
			default: this.bump();
		}
		return {
			val: this.message.slice(t.offset, this.offset()),
			err: null
		};
	}
	parseNumberSkeletonFromString(e, t) {
		let n = [];
		try {
			n = ae(e);
		} catch {
			return this.error(7, t);
		}
		return {
			val: {
				type: 0,
				tokens: n,
				location: t,
				parsedOptions: this.shouldParseSkeletons ? he(n) : {}
			},
			err: null
		};
	}
	tryParsePluralOrSelectOptions(e, t, n, r) {
		let i = !1, a = [], o = /* @__PURE__ */ new Set(), { value: s, location: c } = r;
		for (;;) {
			if (s.length === 0) {
				let e = this.clonePosition();
				if (t !== "select" && this.bumpIf("=")) {
					let t = this.tryParseDecimalInteger(16, 19);
					if (t.err) return t;
					c = Fe(e, this.clonePosition()), s = this.message.slice(e.offset, this.offset());
				} else break;
			}
			if (o.has(s)) return this.error(t === "select" ? 21 : 20, c);
			s === "other" && (i = !0), this.bumpSpace();
			let r = this.clonePosition();
			if (!this.bumpIf("{")) return this.error(t === "select" ? 17 : 18, Fe(this.clonePosition(), this.clonePosition()));
			let l = this.parseMessage(e + 1, t, n);
			if (l.err) return l;
			let u = this.tryParseArgumentClose(r);
			if (u.err) return u;
			a.push([s, {
				value: l.val,
				location: Fe(r, this.clonePosition())
			}]), o.add(s), this.bumpSpace(), {value: s, location: c} = this.parseIdentifierIfPossible();
		}
		return a.length === 0 ? this.error(t === "select" ? 15 : 16, Fe(this.clonePosition(), this.clonePosition())) : this.requiresOtherClause && !i ? this.error(22, Fe(this.clonePosition(), this.clonePosition())) : {
			val: a,
			err: null
		};
	}
	tryParseDecimalInteger(e, t) {
		let n = 1, r = this.clonePosition();
		this.bumpIf("+") || this.bumpIf("-") && (n = -1);
		let i = !1, a = 0;
		for (; !this.isEOF();) {
			let e = this.char();
			if (e >= 48 && e <= 57) i = !0, a = a * 10 + (e - 48), this.bump();
			else break;
		}
		let o = Fe(r, this.clonePosition());
		return i ? (a *= n, Number.isSafeInteger(a) ? {
			val: a,
			err: null
		} : this.error(t, o)) : this.error(e, o);
	}
	offset() {
		return this.position.offset;
	}
	isEOF() {
		return this.offset() === this.message.length;
	}
	clonePosition() {
		return {
			offset: this.position.offset,
			line: this.position.line,
			column: this.position.column
		};
	}
	char() {
		let e = this.position.offset;
		if (e >= this.message.length) throw Error("out of bound");
		let t = this.message.codePointAt(e);
		if (t === void 0) throw Error(`Offset ${e} is at invalid UTF-16 code unit boundary`);
		return t;
	}
	error(e, t) {
		return {
			val: null,
			err: {
				kind: e,
				message: this.message,
				location: t
			}
		};
	}
	bump() {
		if (this.isEOF()) return;
		let e = this.char();
		e === 10 ? (this.position.line += 1, this.position.column = 1, this.position.offset += 1) : (this.position.column += 1, this.position.offset += e < 65536 ? 1 : 2);
	}
	bumpIf(e) {
		if (this.message.startsWith(e, this.offset())) {
			for (let t = 0; t < e.length; t++) this.bump();
			return !0;
		}
		return !1;
	}
	bumpUntil(e) {
		let t = this.offset(), n = this.message.indexOf(e, t);
		return n >= 0 ? (this.bumpTo(n), !0) : (this.bumpTo(this.message.length), !1);
	}
	bumpTo(e) {
		if (this.offset() > e) throw Error(`targetOffset ${e} must be greater than or equal to the current offset ${this.offset()}`);
		for (e = Math.min(e, this.message.length);;) {
			let t = this.offset();
			if (t === e) break;
			if (t > e) throw Error(`targetOffset ${e} is at invalid UTF-16 code unit boundary`);
			if (this.bump(), this.isEOF()) break;
		}
	}
	bumpSpace() {
		for (; !this.isEOF() && Xe(this.char());) this.bump();
	}
	peek() {
		if (this.isEOF()) return null;
		let e = this.char(), t = this.offset();
		return this.message.charCodeAt(t + (e >= 65536 ? 2 : 1)) ?? null;
	}
};
function qe(e) {
	return e >= 97 && e <= 122 || e >= 65 && e <= 90;
}
function Je(e) {
	return qe(e) || e === 47;
}
function Ye(e) {
	return e === 45 || e === 46 || e >= 48 && e <= 57 || e === 95 || e >= 97 && e <= 122 || e >= 65 && e <= 90 || e == 183 || e >= 192 && e <= 214 || e >= 216 && e <= 246 || e >= 248 && e <= 893 || e >= 895 && e <= 8191 || e >= 8204 && e <= 8205 || e >= 8255 && e <= 8256 || e >= 8304 && e <= 8591 || e >= 11264 && e <= 12271 || e >= 12289 && e <= 55295 || e >= 63744 && e <= 64975 || e >= 65008 && e <= 65533 || e >= 65536 && e <= 983039;
}
function Xe(e) {
	return e >= 9 && e <= 13 || e === 32 || e === 133 || e >= 8206 && e <= 8207 || e === 8232 || e === 8233;
}
function Ze(e) {
	e.forEach((e) => {
		if (delete e.location, Se(e) || Ce(e)) for (let t in e.options) delete e.options[t].location, Ze(e.options[t].value);
		else be(e) && Ee(e.style) || (xe(e) || k(e)) && De(e.style) ? delete e.style.location : Te(e) && Ze(e.children);
	});
}
function Qe(e, t = {}) {
	t = {
		shouldParseSkeletons: !0,
		requiresOtherClause: !0,
		...t
	};
	let n = new Ke(e, t).parse();
	if (n.err) {
		let e = SyntaxError(ge[n.err.kind]);
		throw e.location = n.err.location, e.originalMessage = n.err.message, e;
	}
	return t?.captureLocation || Ze(n.val), n.val;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/intl-messageformat/index.js
var $e = /* @__PURE__ */ function(e) {
	return e.MISSING_VALUE = "MISSING_VALUE", e.INVALID_VALUE = "INVALID_VALUE", e.MISSING_INTL_API = "MISSING_INTL_API", e;
}({}), et = class extends Error {
	constructor(e, t, n) {
		super(e), this.code = t, this.originalMessage = n;
	}
	toString() {
		return `[formatjs Error: ${this.code}] ${this.message}`;
	}
}, tt = class extends et {
	constructor(e, t, n, r) {
		super(`Invalid values for "${e}": "${t}". Options are "${Object.keys(n).join("\", \"")}"`, "INVALID_VALUE", r);
	}
}, nt = class extends et {
	constructor(e, t, n) {
		super(`Value for "${e}" must be of type ${t}`, "INVALID_VALUE", n);
	}
}, rt = class extends et {
	constructor(e, t) {
		super(`The intl string context variable "${e}" was not provided to the string "${t}"`, "MISSING_VALUE", t);
	}
};
function it(e) {
	return e.length < 2 ? e : e.reduce((e, t) => {
		let n = e[e.length - 1];
		return !n || n.type !== 0 || t.type !== 0 ? e.push(t) : n.value += t.value, e;
	}, []);
}
function at(e) {
	return typeof e == "function";
}
function ot(e, t, n, r, i, a, o) {
	if (e.length === 1 && ve(e[0])) return [{
		type: 0,
		value: e[0].value
	}];
	let s = [];
	for (let c of e) {
		if (ve(c)) {
			s.push({
				type: 0,
				value: c.value
			});
			continue;
		}
		if (we(c)) {
			typeof a == "number" && s.push({
				type: 0,
				value: n.getNumberFormat(t).format(a)
			});
			continue;
		}
		let { value: e } = c;
		if (!(i && e in i)) throw new rt(e, o);
		let l = i[e];
		if (ye(c)) {
			(!l || typeof l == "string" || typeof l == "number" || typeof l == "bigint") && (l = typeof l == "string" || typeof l == "number" || typeof l == "bigint" ? String(l) : ""), s.push({
				type: typeof l == "string" ? 0 : 1,
				value: l
			});
			continue;
		}
		if (xe(c)) {
			let e = typeof c.style == "string" ? r.date[c.style] : De(c.style) ? c.style.parsedOptions : void 0;
			s.push({
				type: 0,
				value: n.getDateTimeFormat(t, e).format(l)
			});
			continue;
		}
		if (k(c)) {
			let e = typeof c.style == "string" ? r.time[c.style] : De(c.style) ? c.style.parsedOptions : r.time.medium;
			s.push({
				type: 0,
				value: n.getDateTimeFormat(t, e).format(l)
			});
			continue;
		}
		if (be(c)) {
			let e = typeof c.style == "string" ? r.number[c.style] : Ee(c.style) ? c.style.parsedOptions : void 0;
			if (e && e.scale) {
				let t = e.scale || 1;
				if (typeof l == "bigint") {
					if (!Number.isInteger(t)) throw TypeError(`Cannot apply fractional scale ${t} to bigint value. Scale must be an integer when formatting bigint.`);
					l *= BigInt(t);
				} else l *= t;
			}
			s.push({
				type: 0,
				value: n.getNumberFormat(t, e).format(l)
			});
			continue;
		}
		if (Te(c)) {
			let { children: e, value: l } = c, u = i[l];
			if (!at(u)) throw new nt(l, "function", o);
			let d = u(ot(e, t, n, r, i, a).map((e) => e.value));
			Array.isArray(d) || (d = [d]), s.push(...d.map((e) => ({
				type: typeof e == "string" ? 0 : 1,
				value: e
			})));
		}
		if (Se(c)) {
			let e = l, a = (Object.prototype.hasOwnProperty.call(c.options, e) ? c.options[e] : void 0) || c.options.other;
			if (!a) throw new tt(c.value, l, Object.keys(c.options), o);
			s.push(...ot(a.value, t, n, r, i));
			continue;
		}
		if (Ce(c)) {
			let e = `=${l}`, a = Object.prototype.hasOwnProperty.call(c.options, e) ? c.options[e] : void 0;
			if (!a) {
				if (!Intl.PluralRules) throw new et("Intl.PluralRules is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-pluralrules\"\n", "MISSING_INTL_API", o);
				let e = typeof l == "bigint" ? Number(l) : l, r = n.getPluralRules(t, { type: c.pluralType }).select(e - (c.offset || 0));
				a = (Object.prototype.hasOwnProperty.call(c.options, r) ? c.options[r] : void 0) || c.options.other;
			}
			if (!a) throw new tt(c.value, l, Object.keys(c.options), o);
			let u = typeof l == "bigint" ? Number(l) : l;
			s.push(...ot(a.value, t, n, r, i, u - (c.offset || 0)));
			continue;
		}
	}
	return it(s);
}
function st(e, t) {
	return t ? {
		...e,
		...t,
		...Object.keys(e).reduce((n, r) => (n[r] = {
			...e[r],
			...t[r]
		}, n), {})
	} : e;
}
function ct(e, t) {
	return t ? Object.keys(e).reduce((n, r) => (n[r] = st(e[r], t[r]), n), { ...e }) : e;
}
function lt(e) {
	return { create() {
		return {
			get(t) {
				return e[t];
			},
			set(t, n) {
				e[t] = n;
			}
		};
	} };
}
function ut(e = {
	number: {},
	dateTime: {},
	pluralRules: {}
}) {
	return {
		getNumberFormat: y((...e) => new Intl.NumberFormat(...e), {
			cache: lt(e.number),
			strategy: O.variadic
		}),
		getDateTimeFormat: y((...e) => new Intl.DateTimeFormat(...e), {
			cache: lt(e.dateTime),
			strategy: O.variadic
		}),
		getPluralRules: y((...e) => new Intl.PluralRules(...e), {
			cache: lt(e.pluralRules),
			strategy: O.variadic
		})
	};
}
var dt = class e {
	constructor(t, n = e.defaultLocale, r, i) {
		if (this.formatterCache = {
			number: {},
			dateTime: {},
			pluralRules: {}
		}, this.format = ((e) => {
			let t = this.formatToParts(e);
			if (t.length === 1) return t[0].value;
			let n = t.reduce((e, t) => (!e.length || t.type !== 0 || typeof e[e.length - 1] != "string" ? e.push(t.value) : e[e.length - 1] += t.value, e), []);
			return n.length <= 1 ? n[0] || "" : n;
		}), this.formatToParts = ((e) => ot(this.ast, this.locales, this.formatters, this.formats, e, void 0, this.message)), this.resolvedOptions = () => ({ locale: this.resolvedLocale?.toString() || Intl.NumberFormat.supportedLocalesOf(this.locales)[0] }), this.getAst = () => this.ast, this.locales = n, this.resolvedLocale = e.resolveLocale(n), typeof t == "string") {
			if (this.message = t, !e.__parse) throw TypeError("IntlMessageFormat.__parse must be set to process `message` of type `string`");
			let { ...n } = i || {};
			this.ast = e.__parse(t, {
				...n,
				locale: this.resolvedLocale
			});
		} else this.ast = t;
		if (!Array.isArray(this.ast)) throw TypeError("A message must be provided as a String or AST.");
		this.formats = ct(e.formats, r), this.formatters = i && i.formatters || ut(this.formatterCache);
	}
	static {
		this.memoizedDefaultLocale = null;
	}
	static get defaultLocale() {
		return e.memoizedDefaultLocale ||= new Intl.NumberFormat().resolvedOptions().locale, e.memoizedDefaultLocale;
	}
	static {
		this.resolveLocale = (e) => {
			if (Intl.Locale === void 0) return;
			let t = Intl.NumberFormat.supportedLocalesOf(e);
			return t.length > 0 ? new Intl.Locale(t[0]) : new Intl.Locale(typeof e == "string" ? e : e[0]);
		};
	}
	static {
		this.__parse = Qe;
	}
	static {
		this.formats = {
			number: {
				integer: { maximumFractionDigits: 0 },
				currency: { style: "currency" },
				percent: { style: "percent" }
			},
			date: {
				short: {
					month: "numeric",
					day: "numeric",
					year: "2-digit"
				},
				medium: {
					month: "short",
					day: "numeric",
					year: "numeric"
				},
				long: {
					month: "long",
					day: "numeric",
					year: "numeric"
				},
				full: {
					weekday: "long",
					month: "long",
					day: "numeric",
					year: "numeric"
				}
			},
			time: {
				short: {
					hour: "numeric",
					minute: "numeric"
				},
				medium: {
					hour: "numeric",
					minute: "numeric",
					second: "numeric"
				},
				long: {
					hour: "numeric",
					minute: "numeric",
					second: "numeric",
					timeZoneName: "short"
				},
				full: {
					hour: "numeric",
					minute: "numeric",
					second: "numeric",
					timeZoneName: "short"
				}
			}
		};
	}
}, ft = class e extends Error {
	constructor(t, n, r) {
		let i = r ? r instanceof Error ? r : Error(String(r)) : void 0;
		super(`[@formatjs/intl Error ${t}] ${n}
${i ? `\n${i.message}\n${i.stack}` : ""}`), this.code = t, typeof Error.captureStackTrace == "function" && Error.captureStackTrace(this, e);
	}
}, pt = class extends ft {
	constructor(e, t) {
		super("UNSUPPORTED_FORMATTER", e, t);
	}
}, mt = class extends ft {
	constructor(e, t) {
		super("INVALID_CONFIG", e, t);
	}
}, ht = class extends ft {
	constructor(e, t) {
		super("MISSING_DATA", e, t);
	}
}, gt = class extends ft {
	constructor(e, t, n) {
		super("FORMAT_ERROR", `${e}
Locale: ${t}
`, n), this.locale = t;
	}
}, _t = class extends gt {
	constructor(e, t, n, r) {
		super(`${e}
MessageID: ${n?.id}
Default Message: ${n?.defaultMessage}
Description: ${n?.description}
`, t, r), this.descriptor = n, this.locale = t;
	}
}, vt = class extends ft {
	constructor(e, t) {
		super("MISSING_TRANSLATION", `Missing message: "${e.id}" for locale "${t}", using ${e.defaultMessage ? `default message (${typeof e.defaultMessage == "string" ? e.defaultMessage : e.defaultMessage.map((e) => e.value ?? JSON.stringify(e)).join()})` : "id"} as fallback.`), this.descriptor = e;
	}
};
function yt(e, t, n = Error) {
	if (!e) throw new n(t);
}
function bt(e, t, n = {}) {
	return t.reduce((t, r) => (r in e ? t[r] = e[r] : r in n && (t[r] = n[r]), t), {});
}
var xt = {
	formats: {},
	messages: {},
	timeZone: void 0,
	defaultLocale: "en",
	defaultFormats: {},
	fallbackOnEmptyString: !0,
	onError: (e) => {},
	onWarn: (e) => {}
};
function St() {
	return {
		dateTime: {},
		number: {},
		message: {},
		duration: {},
		relativeTime: {},
		pluralRules: {},
		list: {},
		displayNames: {}
	};
}
function Ct(e) {
	return { create() {
		return {
			get(t) {
				return e[t];
			},
			set(t, n) {
				e[t] = n;
			}
		};
	} };
}
function wt(e = St()) {
	let t = Intl.RelativeTimeFormat, n = Intl.ListFormat, r = Intl.DisplayNames, i = y((...e) => new Intl.DateTimeFormat(...e), {
		cache: Ct(e.dateTime),
		strategy: O.variadic
	}), a = y((...e) => new Intl.NumberFormat(...e), {
		cache: Ct(e.number),
		strategy: O.variadic
	}), o = y((...e) => new Intl.PluralRules(...e), {
		cache: Ct(e.pluralRules),
		strategy: O.variadic
	});
	return {
		getDateTimeFormat: i,
		getNumberFormat: a,
		getMessageFormat: y((e, t, n, r) => new dt(e, t, n, {
			formatters: {
				getNumberFormat: a,
				getDateTimeFormat: i,
				getPluralRules: o
			},
			...r
		}), {
			cache: Ct(e.message),
			strategy: O.variadic
		}),
		getDurationFormat: y((...e) => new Intl.DurationFormat(...e), {
			cache: Ct(e.duration),
			strategy: O.variadic
		}),
		getRelativeTimeFormat: y((...e) => new t(...e), {
			cache: Ct(e.relativeTime),
			strategy: O.variadic
		}),
		getPluralRules: o,
		getListFormat: y((...e) => new n(...e), {
			cache: Ct(e.list),
			strategy: O.variadic
		}),
		getDisplayNames: y((...e) => new r(...e), {
			cache: Ct(e.displayNames),
			strategy: O.variadic
		})
	};
}
function Tt(e, t, n, r) {
	let i = e && e[t], a;
	if (i && (a = i[n]), a) return a;
	r(new pt(`No ${t} format named: ${n}`));
}
function Et(e, t) {
	return Object.keys(e).reduce((n, r) => (n[r] = {
		timeZone: t,
		...e[r]
	}, n), {});
}
function Dt(e, t) {
	return Object.keys({
		...e,
		...t
	}).reduce((n, r) => (n[r] = {
		...e[r],
		...t[r]
	}, n), {});
}
function Ot(e, t) {
	if (!t) return e;
	let n = dt.formats;
	return {
		...n,
		...e,
		date: Dt(Et(n.date, t), Et(e.date || {}, t)),
		time: Dt(Et(n.time, t), Et(e.time || {}, t))
	};
}
function kt(e) {
	let { defaultMessage: t } = e;
	try {
		return t === void 0 ? `\nMessage Descriptor: ${JSON.stringify(e)}` : `\nDefault Message: ${typeof t == "string" ? t : JSON.stringify(t)}`;
	} catch {
		return "";
	}
}
var At = ({ locale: e, formats: t, messages: n, defaultLocale: r, defaultFormats: i, fallbackOnEmptyString: a, onError: o, timeZone: s, defaultRichTextElements: c }, l, u = { id: "" }, d, f) => {
	let { id: p, defaultMessage: m } = u;
	p || yt(!1, `[@formatjs/intl] An \`id\` must be provided to format a message. You can either:
1. Configure your build toolchain with [babel-plugin-formatjs](https://formatjs.github.io/docs/tooling/babel-plugin)
or [@formatjs/ts-transformer](https://formatjs.github.io/docs/tooling/ts-transformer) OR
2. Configure your \`eslint\` config to include [eslint-plugin-formatjs](https://formatjs.github.io/docs/tooling/linter#enforce-id)
to autofix this issue${kt(u)}`);
	let h = String(p), g = n && Object.prototype.hasOwnProperty.call(n, h) && n[h];
	if (Array.isArray(g) && g.length === 1 && g[0].type === _e.literal) return g[0].value;
	if (d = {
		...c,
		...d
	}, t = Ot(t, s), i = Ot(i, s), !g) {
		if (a === !1 && g === "") return g;
		if ((!m || e && e.toLowerCase() !== r.toLowerCase()) && o(new vt(u, e)), m) try {
			return l.getMessageFormat(m, r, i, f).format(d);
		} catch (t) {
			return o(new _t(`Error formatting default message for: "${h}", rendering default message verbatim`, e, u, t)), typeof m == "string" ? m : h;
		}
		return h;
	}
	try {
		return l.getMessageFormat(g, e, t, {
			formatters: l,
			...f
		}).format(d);
	} catch (t) {
		o(new _t(`Error formatting message: "${h}", using ${m ? "default message" : "id"} as fallback.`, e, u, t));
	}
	if (m) try {
		return l.getMessageFormat(m, r, i, f).format(d);
	} catch (t) {
		o(new _t(`Error formatting the default message for: "${h}", rendering message verbatim`, e, u, t));
	}
	return typeof g == "string" ? g : typeof m == "string" ? m : h;
}, jt = [
	"formatMatcher",
	"timeZone",
	"hour12",
	"weekday",
	"era",
	"year",
	"month",
	"day",
	"hour",
	"minute",
	"second",
	"timeZoneName",
	"hourCycle",
	"dateStyle",
	"timeStyle",
	"calendar",
	"numberingSystem",
	"fractionalSecondDigits"
];
function Mt({ locale: e, formats: t, onError: n, timeZone: r }, i, a, o = {}) {
	let { format: s } = o, c = bt(o, jt, {
		...r && { timeZone: r },
		...s && Tt(t, i, s, n)
	});
	return i === "time" && !c.hour && !c.minute && !c.second && !c.timeStyle && !c.dateStyle && (c = {
		...c,
		hour: "numeric",
		minute: "numeric"
	}), a(e, c);
}
function Nt(e, t, n, r = {}) {
	let i = typeof n == "string" ? new Date(n || 0) : n;
	try {
		return Mt(e, "date", t, r).format(i);
	} catch (t) {
		e.onError(new gt("Error formatting date.", e.locale, t));
	}
	return String(i);
}
function Pt(e, t, n, r = {}) {
	let i = typeof n == "string" ? new Date(n || 0) : n;
	try {
		return Mt(e, "time", t, r).format(i);
	} catch (t) {
		e.onError(new gt("Error formatting time.", e.locale, t));
	}
	return String(i);
}
function Ft(e, t, n, r, i = {}) {
	let a = typeof n == "string" ? new Date(n || 0) : n, o = typeof r == "string" ? new Date(r || 0) : r;
	try {
		return Mt(e, "dateTimeRange", t, i).formatRange(a, o);
	} catch (t) {
		e.onError(new gt("Error formatting date time range.", e.locale, t));
	}
	return String(a);
}
function It(e, t, n, r = {}) {
	let i = typeof n == "string" ? new Date(n || 0) : n;
	try {
		return Mt(e, "date", t, r).formatToParts(i);
	} catch (t) {
		e.onError(new gt("Error formatting date.", e.locale, t));
	}
	return [];
}
function Lt(e, t, n, r = {}) {
	let i = typeof n == "string" ? new Date(n || 0) : n;
	try {
		return Mt(e, "time", t, r).formatToParts(i);
	} catch (t) {
		e.onError(new gt("Error formatting time.", e.locale, t));
	}
	return [];
}
var Rt = [
	"style",
	"numberingSystem",
	"years",
	"yearsDisplay",
	"months",
	"monthsDisplay",
	"weeks",
	"weeksDisplay",
	"days",
	"daysDisplay",
	"hours",
	"hoursDisplay",
	"minutes",
	"minutesDisplay",
	"seconds",
	"secondsDisplay",
	"milliseconds",
	"millisecondsDisplay",
	"microseconds",
	"microsecondsDisplay",
	"nanoseconds",
	"nanosecondsDisplay",
	"fractionalDigits"
];
function zt({ locale: e, formats: t, onError: n }, r, i) {
	if (!Intl.DurationFormat) {
		n(new et("Intl.DurationFormat is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-durationformat\"", $e.MISSING_INTL_API));
		return;
	}
	let { format: a } = i;
	return r(e, bt(i, Rt, a && Tt(t, "duration", a, n) || {}));
}
function Bt(e, t, n, r = {}) {
	try {
		return zt(e, t, r)?.format(n) ?? "";
	} catch (t) {
		e.onError(new gt("Error formatting duration.", e.locale, t));
	}
	return "";
}
function Vt(e, t, n, r = {}) {
	try {
		return zt(e, t, r)?.formatToParts(n) ?? [];
	} catch (t) {
		e.onError(new gt("Error formatting duration.", e.locale, t));
	}
	return [];
}
var Ht = [
	"style",
	"type",
	"fallback",
	"languageDisplay"
];
function Ut({ locale: e, onError: t }, n, r, i) {
	Intl.DisplayNames || t(new et("Intl.DisplayNames is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-displaynames\"\n", $e.MISSING_INTL_API));
	let a = bt(i, Ht);
	try {
		return n(e, a).of(r);
	} catch (n) {
		t(new gt("Error formatting display name.", e, n));
	}
}
var Wt = ["type", "style"], Gt = Date.now();
function Kt(e) {
	return `${Gt}_${e}_${Gt}`;
}
function qt(e, t, n, r = {}) {
	let i = Jt(e, t, n, r).reduce((e, t) => {
		let n = t.value;
		return typeof n == "string" && typeof e[e.length - 1] == "string" ? e[e.length - 1] += n : e.push(n), e;
	}, []);
	return i.length === 1 ? i[0] : i.length === 0 ? "" : i;
}
function Jt({ locale: e, onError: t }, n, r, i = {}) {
	Intl.ListFormat || t(new et("Intl.ListFormat is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-listformat\"\n", $e.MISSING_INTL_API));
	let a = bt(i, Wt);
	try {
		let t = {}, i = Array.from(r).map((e, n) => {
			if (typeof e == "object" && e) {
				let r = Kt(n);
				return t[r] = e, r;
			}
			return String(e);
		});
		return n(e, a).formatToParts(i).map((e) => e.type === "literal" ? e : {
			...e,
			value: t[e.value] || e.value
		});
	} catch (n) {
		t(new gt("Error formatting list.", e, n));
	}
	return r;
}
var Yt = ["type"];
function Xt({ locale: e, onError: t }, n, r, i = {}) {
	Intl.PluralRules || t(new et("Intl.PluralRules is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-pluralrules\"\n", $e.MISSING_INTL_API));
	let a = bt(i, Yt);
	try {
		return n(e, a).select(r);
	} catch (n) {
		t(new gt("Error formatting plural.", e, n));
	}
	return "other";
}
var Zt = ["numeric", "style"];
function Qt({ locale: e, formats: t, onError: n }, r, i = {}) {
	let { format: a } = i;
	return r(e, bt(i, Zt, !!a && Tt(t, "relative", a, n) || {}));
}
function $t(e, t, n, r, i = {}) {
	r ||= "second", Intl.RelativeTimeFormat || e.onError(new et("Intl.RelativeTimeFormat is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-relativetimeformat\"\n", $e.MISSING_INTL_API));
	try {
		return Qt(e, t, i).format(n, r);
	} catch (t) {
		e.onError(new gt("Error formatting relative time.", e.locale, t));
	}
	return String(n);
}
var en = [
	"style",
	"currency",
	"unit",
	"unitDisplay",
	"useGrouping",
	"minimumIntegerDigits",
	"minimumFractionDigits",
	"maximumFractionDigits",
	"minimumSignificantDigits",
	"maximumSignificantDigits",
	"compactDisplay",
	"currencyDisplay",
	"currencySign",
	"notation",
	"signDisplay",
	"unit",
	"unitDisplay",
	"numberingSystem",
	"trailingZeroDisplay",
	"roundingPriority",
	"roundingIncrement",
	"roundingMode"
];
function tn({ locale: e, formats: t, onError: n }, r, i = {}) {
	let { format: a } = i;
	return r(e, bt(i, en, a && Tt(t, "number", a, n) || {}));
}
function nn(e, t, n, r = {}) {
	try {
		return tn(e, t, r).format(n);
	} catch (t) {
		e.onError(new gt("Error formatting number.", e.locale, t));
	}
	return String(n);
}
function rn(e, t, n, r = {}) {
	try {
		return tn(e, t, r).formatToParts(n);
	} catch (t) {
		e.onError(new gt("Error formatting number.", e.locale, t));
	}
	return [];
}
function an(e) {
	return typeof (e ? e[Object.keys(e)[0]] : void 0) == "string";
}
function on(e) {
	e.onWarn && e.defaultRichTextElements && an(e.messages || {}) && e.onWarn("[@formatjs/intl] \"defaultRichTextElements\" was specified but \"message\" was not pre-compiled. \nPlease consider using \"@formatjs/cli\" to pre-compile your messages for performance.\nFor more details see https://formatjs.github.io/docs/getting-started/message-distribution");
}
function sn(e, t) {
	let n = wt(t), r = {
		...xt,
		...e
	}, { locale: i, defaultLocale: a, onError: o } = r;
	return i ? !Intl.NumberFormat.supportedLocalesOf(i).length && o ? o(new ht(`Missing locale data for locale: "${i}" in Intl.NumberFormat. Using default locale: "${a}" as fallback. See https://formatjs.github.io/docs/react-intl#runtime-requirements for more details`)) : !Intl.DateTimeFormat.supportedLocalesOf(i).length && o && o(new ht(`Missing locale data for locale: "${i}" in Intl.DateTimeFormat. Using default locale: "${a}" as fallback. See https://formatjs.github.io/docs/react-intl#runtime-requirements for more details`)) : (o && o(new mt(`"locale" was not configured, using "${a}" as fallback. See https://formatjs.github.io/docs/react-intl/api#intlshape for more details`)), r.locale = r.defaultLocale || "en"), on(r), {
		...r,
		formatters: n,
		formatNumber: nn.bind(null, r, n.getNumberFormat),
		formatNumberToParts: rn.bind(null, r, n.getNumberFormat),
		formatDuration: Bt.bind(null, r, n.getDurationFormat),
		formatDurationToParts: Vt.bind(null, r, n.getDurationFormat),
		formatRelativeTime: $t.bind(null, r, n.getRelativeTimeFormat),
		formatDate: Nt.bind(null, r, n.getDateTimeFormat),
		formatDateToParts: It.bind(null, r, n.getDateTimeFormat),
		formatTime: Pt.bind(null, r, n.getDateTimeFormat),
		formatDateTimeRange: Ft.bind(null, r, n.getDateTimeFormat),
		formatTimeToParts: Lt.bind(null, r, n.getDateTimeFormat),
		formatPlural: Xt.bind(null, r, n.getPluralRules),
		formatMessage: At.bind(null, r, n),
		$t: At.bind(null, r, n),
		formatList: qt.bind(null, r, n.getListFormat),
		formatListToParts: Jt.bind(null, r, n.getListFormat),
		formatDisplayName: Ut.bind(null, r, n.getDisplayNames)
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react/cjs/react-jsx-runtime.production.js
var cn = /* @__PURE__ */ o(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.fragment");
	function r(e, n, r) {
		var i = null;
		if (r !== void 0 && (i = "" + r), n.key !== void 0 && (i = "" + n.key), "key" in n) for (var a in r = {}, n) a !== "key" && (r[a] = n[a]);
		else r = n;
		return n = r.ref, {
			$$typeof: t,
			type: e,
			key: i,
			ref: n === void 0 ? null : n,
			props: r
		};
	}
	e.Fragment = n, e.jsx = r, e.jsxs = r;
})), A = (/* @__PURE__ */ o(((e, t) => {
	t.exports = cn();
})))();
function ln(e, t, n = Error) {
	if (!e) throw new n(t);
}
function un(e) {
	ln(e, "[React Intl] Could not find required `intl` object. <IntlProvider> needs to exist in the component ancestry.");
}
var dn = {
	...xt,
	textComponent: _.Fragment
}, fn = (e) => _.Children.toArray(e).map((e, t) => _.isValidElement(e) ? /* @__PURE__ */ (0, A.jsx)(_.Fragment, { children: e }, t) : e);
function pn(e) {
	return function(t) {
		return e(fn(t));
	};
}
function mn(e, t) {
	if (e === t) return !0;
	if (!e || !t) return !1;
	var n = Object.keys(e), r = Object.keys(t), i = n.length;
	if (r.length !== i) return !1;
	for (var a = 0; a < i; a++) {
		var o = n[a];
		if (e[o] !== t[o] || !Object.prototype.hasOwnProperty.call(t, o)) return !1;
	}
	return !0;
}
var hn = _.createContext(null), gn = hn.Provider;
function _n() {
	let e = _.useContext(hn);
	return un(e), e;
}
var vn = /* @__PURE__ */ function(e) {
	return e.formatDate = "FormattedDate", e.formatTime = "FormattedTime", e.formatNumber = "FormattedNumber", e.formatList = "FormattedList", e.formatDuration = "FormattedDuration", e.formatDisplayName = "FormattedDisplayName", e;
}(vn || {}), yn = /* @__PURE__ */ function(e) {
	return e.formatDate = "FormattedDateParts", e.formatTime = "FormattedTimeParts", e.formatNumber = "FormattedNumberParts", e.formatList = "FormattedListParts", e;
}(yn || {});
function bn(e) {
	let t = (t) => {
		let n = _n(), { value: r, children: i, ...a } = t, o = typeof r == "string" ? new Date(r || 0) : r;
		return i(e === "formatDate" ? n.formatDateToParts(o, a) : n.formatTimeToParts(o, a));
	};
	return t.displayName = yn[e], t;
}
function xn(e) {
	let t = (t) => {
		let n = _n(), { value: r, children: i, ...a } = t, o = n[e](r, a);
		if (typeof i == "function") return i(o);
		let s = n.textComponent || _.Fragment;
		return /* @__PURE__ */ (0, A.jsx)(s, { children: o });
	};
	return t.displayName = vn[e], t;
}
function Sn(e) {
	return e && Object.keys(e).reduce((t, n) => {
		let r = e[n];
		return t[n] = at(r) ? pn(r) : r, t;
	}, {});
}
var Cn = (e, t, n, r, ...i) => {
	let a = At(e, t, n, Sn(r), ...i);
	return Array.isArray(a) ? fn(a) : a;
}, wn = ({ defaultRichTextElements: e, ...t }, n) => {
	let r = Sn(e), i = sn({
		...dn,
		...t,
		defaultRichTextElements: r
	}, n), a = {
		locale: i.locale,
		timeZone: i.timeZone,
		fallbackOnEmptyString: i.fallbackOnEmptyString,
		formats: i.formats,
		defaultLocale: i.defaultLocale,
		defaultFormats: i.defaultFormats,
		messages: i.messages,
		onError: i.onError,
		defaultRichTextElements: r
	};
	return {
		...i,
		formatMessage: Cn.bind(null, a, i.formatters),
		$t: Cn.bind(null, a, i.formatters)
	};
};
function Tn(e, t) {
	let { values: n, ...r } = e, { values: i, ...a } = t;
	return mn(i, n) && mn(r, a);
}
function En(e) {
	let { formatMessage: t, textComponent: n = _.Fragment } = _n(), { id: r, description: i, defaultMessage: a, values: o, children: s, tagName: c = n, ignoreTag: l } = e, u = t({
		id: r,
		description: i,
		defaultMessage: a
	}, o, { ignoreTag: l });
	return typeof s == "function" ? s(Array.isArray(u) ? u : [u]) : c ? /* @__PURE__ */ (0, A.jsx)(c, { children: u }) : /* @__PURE__ */ (0, A.jsx)(A.Fragment, { children: u });
}
En.displayName = "FormattedMessage";
var Dn = _.memo(En, Tn);
Dn.displayName = "MemoizedFormattedMessage";
function On(e) {
	return {
		locale: e.locale,
		timeZone: e.timeZone,
		fallbackOnEmptyString: e.fallbackOnEmptyString,
		formats: e.formats,
		textComponent: e.textComponent,
		messages: e.messages,
		defaultLocale: e.defaultLocale,
		defaultFormats: e.defaultFormats,
		onError: e.onError,
		onWarn: e.onWarn,
		wrapRichTextChunksInFragment: e.wrapRichTextChunksInFragment,
		defaultRichTextElements: e.defaultRichTextElements
	};
}
function kn(e) {
	let t = _.useRef(St()), n = _.useRef(void 0), r = _.useRef(void 0), i = {};
	for (let t in e) e[t] !== void 0 && (i[t] = e[t]);
	let a = On({
		...dn,
		...i
	});
	return (!n.current || !mn(n.current, a)) && (n.current = a, r.current = wn(a, t.current)), un(r.current), /* @__PURE__ */ (0, A.jsx)(gn, {
		value: r.current,
		children: e.children
	});
}
kn.displayName = "IntlProvider";
var An = kn;
xn("formatDate"), xn("formatTime"), xn("formatNumber"), xn("formatDuration"), xn("formatList"), xn("formatDisplayName"), bn("formatDate"), bn("formatTime");
//#endregion
//#region app/ui/src/text/en.json
var jn = {
	"SH-01.wordmark": "chausar",
	"SH-01.rail.label": "Places",
	"SH-01.region.page": "Page",
	"SH-01.region.ask": "Ask line",
	"SH-01.region.status": "Status line",
	"SH-01.count": "{count} awaiting your review",
	"SH-01.status.keys": "Arrow keys move · Enter opens",
	"SH-01.place.today": "Today",
	"SH-01.place.ask": "Ask",
	"SH-01.place.work": "Work",
	"SH-01.place.books": "Books",
	"SH-01.place.reports": "Reports",
	"SH-01.place.tools": "Tools",
	"SH-01.place.trust": "Trust",
	"SH-01.place.more": "More",
	"SH-01.place.company": "Company",
	"SH-01.place.clients": "Clients",
	"SH-01.sub.today.today": "Today",
	"SH-01.sub.today.activity": "Activity",
	"SH-01.sub.ask.new": "New",
	"SH-01.sub.ask.saved": "Saved",
	"SH-01.sub.ask.decisions": "Decisions",
	"SH-01.sub.ask.checks": "Checks",
	"SH-01.sub.ask.notyet": "Not yet",
	"SH-01.sub.ask.plans": "Plans",
	"SH-01.sub.work.approvals": "Approvals",
	"SH-01.sub.work.jobs": "Jobs",
	"SH-01.sub.work.actions": "Actions",
	"SH-01.sub.work.cando": "What it can do",
	"SH-01.sub.work.cases": "Cases",
	"SH-01.sub.work.agents": "Agents",
	"SH-01.sub.work.cosign": "To co-sign",
	"SH-01.sub.work.many": "The same step for many clients",
	"SH-01.sub.work.questions": "Questions sent by clients",
	"SH-01.sub.books.sources": "Sources",
	"SH-01.sub.books.meanings": "Meanings",
	"SH-01.sub.books.accounts": "Accounts",
	"SH-01.sub.books.customers": "Customers",
	"SH-01.sub.books.records": "Records",
	"SH-01.sub.books.history": "History",
	"SH-01.sub.books.memory": "Memory",
	"SH-01.sub.books.issues": "Issues",
	"SH-01.sub.books.companies": "Companies",
	"SH-01.sub.reports.packs": "Packs",
	"SH-01.sub.reports.weekahead": "The week ahead",
	"SH-01.sub.reports.briefs": "Briefs",
	"SH-01.sub.reports.duedates": "Due dates",
	"SH-01.sub.reports.exports": "Exports",
	"SH-01.sub.reports.sent": "Sent",
	"SH-01.sub.reports.handover": "Month-end hand-over",
	"SH-01.sub.tools.smallapps": "Small apps",
	"SH-01.sub.tools.plugins": "Plugins",
	"SH-01.sub.tools.assistants": "Other assistants",
	"SH-01.sub.tools.phone": "Phone",
	"SH-01.sub.tools.planning": "Planning",
	"SH-01.sub.tools.library": "The firm's library",
	"SH-01.sub.tools.invite": "Invite a client",
	"SH-01.sub.trust.rules": "Rules",
	"SH-01.sub.trust.people": "People",
	"SH-01.sub.trust.models": "Models",
	"SH-01.sub.trust.network": "Network",
	"SH-01.sub.trust.record": "Record",
	"SH-01.sub.trust.sharing": "Sharing",
	"SH-01.sub.trust.vault": "Vault",
	"SH-01.sub.trust.access": "Access",
	"SH-01.sub.trust.markings": "Markings",
	"SH-01.sub.trust.retention": "Retention",
	"SH-01.sub.trust.channels": "Channels",
	"SH-01.sub.trust.firmname": "The firm's name on reports",
	"SH-01.sub.company.signin": "Sign-in",
	"SH-01.sub.company.health": "Health",
	"SH-01.sub.company.recovery": "Recovery",
	"SH-01.sub.company.keys": "Keys",
	"SH-01.sub.company.support": "Support access",
	"SH-01.sub.company.computers": "Computers",
	"SH-01.sub.company.quality": "Quality",
	"SH-01.sub.company.build": "Build",
	"SH-01.sub.company.licence": "Licence",
	"SH-02.title": "{workspace} is locked",
	"SH-02.field": "Passphrase or PIN",
	"SH-02.unlock": "Unlock",
	"SH-02.device": "Unlock with {device}",
	"SH-02.forgot": "Forgot passphrase?",
	"SH-02.forgot.note": "Use your recovery kit.",
	"SH-02.paused": "Sources and the AI model are paused while Chausar is locked.",
	"SH-02.wrong": "That is not the passphrase.",
	"SH-02.wait": "Too many tries. Try again at {time}.",
	"SH-03.driving": "Chausar is driving {program}. Press Ctrl Shift Esc to stop.",
	"SH-03.driving.action": "Stop",
	"SH-03.demo-clock": "Demo clock: {date}.",
	"SH-03.read-only": "{holder} holds the pen. This computer is read only.",
	"SH-03.read-only.action": "Ask for the pen",
	"SH-03.sending-closed": "Restored from the backup of {date}. Sending is closed until {count} actions are checked.",
	"SH-03.sending-closed.action": "Check them",
	"SH-03.jobs-paused": "Jobs are paused until you open Chausar.",
	"SH-03.update-needed": "This preview build expired on {date}. Update to keep using sources and actions.",
	"SH-03.update-needed.action": "Update now",
	"SH-03.no-connection": "No connection. Answers from your books still work. Questions in plain words are waiting.",
	"SH-04.placeholder": "Ask a question, or give a task",
	"SH-04.placeholder.firm": "Find a client, or give a task",
	"SH-04.key": "Ctrl K",
	"SH-04.mic": "Hold to talk",
	"SH-04.mic.off": "Voice is off. Open Trust, Rules, Send to switch it on.",
	"SH-04.mic.off.short": "Voice is off",
	"SH-04.mic.cost": "{cost} a minute",
	"SH-04.listening": "Listening",
	"SH-04.noModel": "No AI model connected. Pick a calculation from the menu.",
	"SH-04.readOnly": "Questions work. Tasks wait: {holder} holds the pen.",
	"SH-04.about": "About: {name}",
	"SH-04.about.clear": "Clear",
	"SH-04.kind.calculation": "calculation",
	"SH-04.kind.customer": "customer",
	"SH-04.kind.place": "place",
	"SH-04.kind.saved": "saved answer",
	"SH-06.open": "Workspace, view and language",
	"SH-06.workspaces": "Workspaces",
	"SH-06.companies": "Companies",
	"SH-06.companies.all": "All companies",
	"SH-06.view": "View",
	"SH-06.view.simple": "Simple",
	"SH-06.view.guided": "Guided",
	"SH-06.view.books": "Books",
	"SH-06.language": "Language",
	"SH-06.language.en": "English",
	"SH-06.language.hi": "हिंदी",
	"SH-06.lock": "Lock now",
	"SH-06.about": "About this build",
	"SH-06.demo": "demo",
	"SH-06.real": "real",
	"TD-01.title": "Awaiting your review",
	"TD-01.worth": "Worth a look",
	"TD-01.month": "This month",
	"TD-01.earlier": "Earlier today",
	"TD-01.earlier.none": "Nothing has happened yet today.",
	"TD-01.setup": "Setup: step {step} of {of}",
	"TD-01.update": "Update ready. Your data is saved first.",
	"TD-01.folded": "{count} earlier",
	"TD-02.cash": "Today's cash sales",
	"TD-02.cash.rupee": "₹",
	"TD-03.col.state": "State",
	"TD-03.col.what": "What",
	"TD-03.col.party": "Party or account",
	"TD-03.col.asWritten": "As written in the source",
	"TD-03.col.amount": "Amount",
	"TD-03.col.since": "Since",
	"TD-03.col.then": "Then",
	"TD-03.then.you": "you decide",
	"TD-03.then.owner": "the owner approves",
	"TD-03.then.waiting": "waiting for the owner",
	"TD-03.close": "{month} close",
	"WK-02.field": "Field",
	"WK-02.before": "Before",
	"WK-02.after": "After",
	"WK-02.preparedBy": "prepared by {name}",
	"WK-02.secondAsk": "Approving money asks for your passphrase, PIN or fingerprint first.",
	"WK-02.prepareOnly": "Download the file and the checklist. You or your CA files it.",
	"WK-02.readOnly": "{holder} holds the pen. Nothing can be approved from this computer.",
	"WK-02.readOnly.plain": "Read only. Nothing can be approved from this computer.",
	"WK-02.unsure": "Not sure it went out. Checking before trying again.",
	"CA-01.filter": "Show",
	"CA-01.filter.needs": "Needs you",
	"CA-01.filter.notDone": "Close not done",
	"CA-01.filter.all": "All",
	"CA-01.col.client": "Client",
	"CA-01.col.read": "Books read",
	"CA-01.col.close": "{month} close",
	"CA-01.col.awaiting": "Awaiting you",
	"CA-01.col.due": "Due next",
	"CA-01.col.open": "Open",
	"CA-01.invited": "invited, not joined",
	"CA-01.guide": "Send the guide again",
	"CA-01.more": "{count} more",
	"CA-01.legend": "{month} close, in order: bank, GST, TDS, trial balance",
	"CA-01.vault": "Each client's books stay in that client's own vault.",
	"EN.lens": "Lens",
	"EN.lens.whole-group": "Whole group",
	"EN.lens.finance": "Finance",
	"EN.lens.sales": "Sales",
	"EN.lens.operations": "Operations",
	"EN.whose": "Whose",
	"EN.whose.mine": "Mine",
	"EN.whose.team": "My team",
	"EN.whose.everyone": "Everyone",
	"EN.owner": "prepared by {name}",
	"EN.month": "The group this month",
	"EN.changed": "Changed since {since}",
	"BTN.review": "Review",
	"BTN.approve": "Approve",
	"BTN.notNow": "Not now",
	"BTN.change": "Change",
	"BTN.drop": "Drop",
	"BTN.open": "Open",
	"BTN.prepare": "Prepare",
	"BTN.enter": "Enter",
	"BTN.continue": "Continue",
	"BTN.update": "Update",
	"BTN.close": "Close",
	"BTN.seeAll": "See all {count}",
	"BTN.download": "Get file and checklist",
	"BTN.check": "Check again",
	"BTN.wasSent": "It was sent",
	"BTN.wasNotSent": "It was not sent",
	"SHEET.close": "Close · Esc",
	"SHEET.position": "{kind} · {index} of {total}",
	"SHEET.back": "Back to {what}",
	"SHEET.kind.approval": "Approval",
	"SHEET.kind.receipt": "Receipt",
	"STEP.prepared": "Prepared",
	"STEP.approve": "Approve",
	"STEP.send": "Send",
	"STEP.read-back": "Read back",
	"STEP.recorded": "Recorded",
	"STEP.you": "You",
	"STEP.vault": "Vault",
	"STEP.model": "Model",
	"STEP.books": "Your books",
	"STEP.meanings": "Meanings",
	"STEP.first-answer": "First answer",
	"STEPSTATE.done": "done",
	"STEPSTATE.waiting-for-you": "waiting for you",
	"STEPSTATE.waiting-for-network": "waiting for the network",
	"STEPSTATE.unsure": "not sure what happened",
	"STEPSTATE.stopped-by-rule": "stopped by a rule",
	"STEPSTATE.stopped-by-budget": "stopped by the budget",
	"STEPSTATE.not-reached": "not reached",
	"MARK.cha": "Chausar did this",
	"MARK.you": "yours",
	"MARK.wait": "awaiting your review",
	"MARK.busy": "Chausar's turn, not finished",
	"MARK.unsure": "not sure",
	"MARK.guess": "a guess, not measured",
	"MARK.off": "off",
	"MISSING.absent": "none",
	"MISSING.null": "not known",
	"MISSING.unknown": "not sure",
	"MISSING.withheld": "hidden from your seat",
	"MISSING.not-applicable": "does not apply",
	"MISSING.not-loaded-yet": "not loaded yet",
	"MISSING.not-counted": "not counted",
	"MISSING.cash-not-captured": "cash sales not captured",
	"MISSING.not-agreed": "not agreed",
	"MISSING.none": "none",
	"LABEL.seed": "seed",
	"LABEL.what-if": "what if",
	"LABEL.projection": "projection",
	"LABEL.from-outside": "from outside",
	"LABEL.approximate": "approximate",
	"LABEL.demo-clock": "demo clock",
	"LABEL.stale": "stale",
	"LABEL.guess": "guess",
	"LABEL.measured": "measured",
	"LABEL.told-by-owner": "told by owner",
	"LABEL.assumption": "assumption",
	"LABEL.from-data": "from data",
	"LABEL.recorded-later": "recorded later",
	"LABEL.late": "late",
	"LABEL.practice": "practice",
	"LABEL.experimental": "experimental",
	"LABEL.file": "file",
	"FIGURE.title": "Exact value {exact}. Opens receipt {receipt}",
	"FIGURE.spoken": "{spoken}. Opens its receipt",
	"CHART.open": "Open the receipt for {label}, {amount}",
	"CHART.hover": "{label}: {amount}",
	"CHART.missing": "{label}: {words}",
	"CHART.unavailable.CHART_NOT_PROVIDED": "No chart. No series was supplied.",
	"CHART.unavailable.CHART_FORM_NOT_IMPLEMENTED": "No chart. This form of chart is not built yet.",
	"CHART.unavailable.CHART_HAS_NO_POINTS": "No chart. The series has no points.",
	"CHART.unavailable.CHART_HAS_NO_KNOWN_POINTS": "No chart. No point in the series is known.",
	"CHART.shares.unavailable": "No bar. These values cannot be drawn as parts of one whole.",
	"STRIP.done": "done",
	"STRIP.loading": "loading",
	"STRIP.not-done": "not done",
	"STRIP.refused": "file refused",
	"STRIP.cell": "{label}: {state}.",
	"TIMELINE.who": "by {name}",
	"CHOICE.no": "No",
	"CHOICE.yes": "Yes",
	"ST.loading": "Reading. What was known last time is shown.",
	"ST.loading.lastKnown": "As known at {time}. Reading again.",
	"ST.loading.reading": "Reading {what}",
	"ST.empty.review": "Nothing awaits your review.",
	"ST.empty.sources": "No sources yet.",
	"ST.noChange": "No change since {since}.",
	"ST.noChange.plain": "No change since the last read.",
	"ST.notEnough.plain": "Not enough loaded to tell.",
	"ST.readOnly.plain": "Another computer holds the pen. This computer is read only.",
	"ST.failed": "Something did not work. Nothing was changed.",
	"ST.notEnough": "Not enough loaded to tell. {count, plural, one {{display} month is} other {{display} months are}} not loaded yet.",
	"ST.stale.since": "worked out on {date}, may be out of date",
	"ST.rebuild": "Rebuild",
	"ST.notYet": "Not yet. No calculation covers this.",
	"ST.notYet.wanted": "It is on the wanted list.",
	"ST.rule": "Stopped by a rule: {rule}",
	"ST.rule.who": "{who} can change it.",
	"ST.failed.code": "Code {code}",
	"ST.network": "Waiting for the network. Work that needs no network carries on.",
	"ST.readOnly": "{holder} holds the pen. This computer is read only.",
	"ST.hidden": "Some rows are hidden from your seat.",
	"ST.hidden.total": "The total is refused: it would reveal {count, plural, one {{display} hidden row} other {fewer than {display} hidden rows}}.",
	"ST.refused": "Refused: {reason}",
	"ST.locked": "Chausar is locked.",
	"ST.noAccess": "Your role has no access to this workspace.",
	"ST.notBuilt": "Not built yet.",
	"ST.notBuilt.day": "Not built yet. This arrives on day {day}.",
	"ST.partial.label": "Shown working once, not yet tested on the bench.",
	"ST.partial.plain": "Only part of this is loaded.",
	"ST.stale.plain": "This may be out of date.",
	"ST.rule.plain": "Stopped by a rule.",
	"ST.boundary.reason": "Reason code {code}",
	"ST.boundary.asOf": "As of {asOf}",
	"ASK.workspace.empty": "Ask a question in the line below.",
	"ASK.workspace.busy": "Working on this question.",
	"ASK.workspace.review": "Review what will be sent.",
	"ASK.workspace.continuation": "Answer the clarification in the ask line.",
	"ASK.workspace.unavailable": "This answer is unavailable. Code {code}.",
	"ASK.consent.kind": "AI model request",
	"ASK.consent.planning.title": "Send your question to the AI model",
	"ASK.consent.planning.note": "Send once allows this one request, exactly as shown here. Writing the answer in words is a separate request, and it asks you again.",
	"ASK.consent.planning.send": "Send once",
	"ASK.consent.final-writing.title": "Send the results to be written up",
	"ASK.consent.final-writing.note": "Write once allows this one request, exactly as shown here. It is separate from the request you allowed earlier.",
	"ASK.consent.final-writing.send": "Write once",
	"ASK.consent.cancel": "Cancel",
	"ASK.consent.mismatch.title": "This review cannot be sent",
	"ASK.consent.mismatch": "This review does not match its step, so there is nothing to send. Close it and ask again.",
	"ASK.consent.question": "Your question, as written",
	"ASK.consent.warning.question": "About your question",
	"ASK.consent.warning.definition": "About your calculation definitions",
	"ASK.consent.warning.calculation": "About your calculation inputs",
	"ASK.consent.warning.continuation": "About the earlier exchange",
	"ASK.consent.warning.synthesis": "About the results being sent",
	"ASK.consent.disclosure.question": "The complete question is included separately from evidence Shape. Review it for private names, amounts and instructions before approving.",
	"ASK.consent.disclosure.definition": "Published calculation labels, definitions and parameter meanings are included separately from evidence Shape. Review definition text for private names, amounts and instructions before approving this exact payload.",
	"ASK.consent.disclosure.continuation": "The complete retained original objective, clarification and any prior exchanges are included separately from evidence Shape, with your exact current reply. Review all prior text for private names, amounts and instructions before approving this exact payload.",
	"ASK.consent.disclosure.synthesis": "The exact retained original objective, admitted claim text and derived tool summary are included separately from evidence Shape. Review private names, business details and instructions before approving this separate synthesis transfer once.",
	"ASK.consent.disclosure.original": "Original Engine warning, unchanged",
	"ASK.consent.earlier": "Earlier exchange sent with this",
	"ASK.consent.earlier.question": "Original question",
	"ASK.consent.earlier.clarification": "Clarification asked",
	"ASK.consent.earlier.exchanges": "Exchanges so far",
	"ASK.consent.exchange.question": "Question",
	"ASK.consent.exchange.clarification": "Clarification",
	"ASK.consent.details": "Where it goes",
	"ASK.consent.route": "Route",
	"ASK.consent.endpoint": "Address",
	"ASK.consent.endpoint.unknown": "Not known. This route did not name an address.",
	"ASK.consent.level": "Send level",
	"ASK.consent.level.shape": "Shape only",
	"ASK.consent.level.samples": "Samples",
	"ASK.consent.boundary": "How it travels",
	"ASK.consent.boundary.application-to-provider-http": "From this app straight to the model provider",
	"ASK.consent.boundary.application-to-official-cli": "From this app to the model provider's own tool",
	"ASK.consent.observed": "What the receipt records",
	"ASK.consent.observed.yes": "The request as this app sends it to the provider.",
	"ASK.consent.observed.no": "Only what this app hands to the tool. This app does not see what the tool then sends to its provider.",
	"ASK.consent.preview": "Preview",
	"ASK.consent.digest": "Digest of this text",
	"ASK.consent.continuation.id": "Earlier exchange",
	"ASK.consent.continuation.digest": "Digest of the earlier exchange",
	"ASK.consent.synthesis.turn": "Checked results",
	"ASK.consent.synthesis.digest": "Digest of the results summary",
	"ASK.consent.payload": "Exact text to be sent",
	"ASK.answer.clarification": "The AI model needs one thing first",
	"ASK.answer.continue": "Answer this",
	"ASK.answer.written": "Written by the AI model from the checked results",
	"ASK.answer.cautions": "Cautions",
	"ASK.answer.tools": "Checked results",
	"ASK.answer.tool.business": "About the business",
	"ASK.answer.tool.calculation": "Calculation",
	"ASK.answer.tool.error": "This step gave no result.",
	"ASK.answer.previewWriting": "Preview writing",
	"ASK.answer.previewWriting.note": "This only shows what would be sent to the AI model. Nothing is sent until you review it and choose to send.",
	"ASK.answer.saved.id": "Saved answer",
	"ASK.answer.saved.at": "Saved at",
	"ASK.answer.notSpecified": "not specified",
	"ASK.answer.status": "Status",
	"ASK.answer.sources": "Sources",
	"ASK.answer.contextDigest": "Context digest",
	"ASK.answer.modelReceipt": "Model receipt",
	"ASK.answer.toolReceipt": "Tool receipt",
	"ASK.answer.savedAnswer.business": "Saved business answer",
	"ASK.answer.savedAnswer.calculation": "Saved calculation answer",
	"ASK.answer.calculationReceipt": "Calculation receipt",
	"ASK.answer.businessReceipt": "Business context receipt",
	"ASK.answer.synthesisReceipt": "Writing receipt",
	"ASK.answer.synthesisReceipt.id": "Receipt",
	"ASK.answer.synthesisReceipt.toolTurn": "Checked results used",
	"ASK.answer.synthesisReceipt.planner": "Model receipt for planning",
	"ASK.answer.synthesisReceipt.writer": "Model receipt for writing",
	"ASK.answer.synthesisReceipt.input": "Input digest",
	"ASK.answer.synthesisReceipt.output": "Output digest",
	"ASK.answer.refs.evidence": "Evidence",
	"ASK.answer.refs.answers": "Answers",
	"ASK.answer.refs.receipts": "Receipts",
	"ASK.answer.refs.citations": "Citations",
	"ASK.answer.business.status.grounded": "Established",
	"ASK.answer.business.status.partial": "Partly established",
	"ASK.answer.business.status.unknown": "Not established",
	"ASK.answer.business.claims": "Statements",
	"ASK.answer.business.unknowns": "Not known",
	"ASK.answer.business.conflicts": "Conflicts",
	"ASK.answer.business.limitations": "Limits of this answer",
	"ASK.answer.business.citations": "Sources cited",
	"ASK.answer.category.workspace": "workspace",
	"ASK.answer.category.definitions": "definitions",
	"ASK.answer.category.records": "records",
	"ASK.answer.category.industry": "industry",
	"ASK.answer.category.products": "products",
	"ASK.answer.category.customers": "customers",
	"ASK.answer.category.business_model": "business model",
	"ASK.answer.category.location": "location",
	"ASK.answer.origin.workspace-metadata": "workspace details",
	"ASK.answer.origin.published-definition": "published definition",
	"ASK.answer.origin.source-observation": "seen in a source",
	"ASK.answer.origin.owner-told": "told by owner",
	"ASK.answer.origin.draft-assumption": "draft assumption",
	"ASK.answer.qualification.metadata-only": "details only",
	"ASK.answer.qualification.unqualified-observation": "seen, not confirmed",
	"ASK.answer.qualification.evidence-qualified": "backed by evidence",
	"ASK.answer.qualification.owner-stated": "stated by owner",
	"ASK.answer.qualification.draft": "draft",
	"ASK.answer.citation": "Citation",
	"ASK.answer.citation.kind": "Kind",
	"ASK.answer.citation.kind.workspace": "Workspace",
	"ASK.answer.citation.kind.dictionary": "Dictionary",
	"ASK.answer.citation.kind.fact": "Fact",
	"ASK.answer.citation.kind.profile": "Profile",
	"ASK.answer.citation.path": "Path",
	"ASK.answer.citation.source": "Source",
	"ASK.answer.citation.row": "Source row",
	"ASK.answer.citation.validFrom": "Valid from",
	"ASK.answer.citation.validTo": "Valid to",
	"ASK.answer.citation.learnedAt": "Learned at",
	"ASK.answer.scope.corpus": "Evidence read",
	"ASK.answer.scope.corpus.currently-authorized-local-evidence": "Local evidence you may read now",
	"ASK.answer.scope.completeness": "Completeness",
	"ASK.answer.scope.completeness.bounded": "Bounded, not complete",
	"ASK.answer.scope.branch": "Branch",
	"ASK.answer.scope.asOf": "As known at",
	"ASK.answer.scope.onDate": "On date",
	"ASK.answer.scope.synthetic": "Practice data",
	"ASK.answer.calculation.operation": "Operation",
	"ASK.answer.calculation.period": "Period",
	"ASK.answer.calculation.comparePeriod": "Compared with",
	"ASK.answer.calculation.currency": "Currency",
	"ASK.answer.calculation.requestedSources": "Sources asked for",
	"ASK.answer.calculation.noFigures": "This receipt holds no figures.",
	"ASK.answer.period": "{from} to {to}",
	"ASK.answer.coverage.completeness": "Coverage",
	"ASK.answer.coverage.completeness.reconciled-imports": "Imports reconciled",
	"ASK.answer.coverage.completeness.unreconciled-facts": "Records not reconciled",
	"ASK.answer.coverage.completeness.empty": "Nothing counted",
	"ASK.answer.coverage.completeness.partial": "Partial",
	"ASK.answer.coverage.selected": "Rows selected",
	"ASK.answer.coverage.counted": "Rows counted",
	"ASK.answer.coverage.excluded": "Rows left out",
	"ASK.answer.coverage.conflicts": "Unresolved conflicts",
	"ASK.answer.coverage.gaps": "Coverage gaps",
	"ASK.answer.figure.money.currency": "Exact value {exact}, in minor units of {currency}.",
	"ASK.answer.figure.money": "Exact value {exact}, in minor units.",
	"ASK.answer.figure.points.currency": "Exact value {exact} basis points. Currency {currency}.",
	"ASK.answer.figure.points": "Exact value {exact} basis points.",
	"ASK.answer.calculation.figure": "Figure",
	"ASK.answer.detail.calculation": "Scope, coverage and receipt",
	"ASK.answer.detail.business": "Scope and receipts",
	"ASK.answer.detail.turn": "Receipts and saved answers",
	"ASK.answer.detail.saved": "About this saved answer",
	"ASK.answer.figure.open": "{label}: {display}. {exact} Opens calculation receipt {receipt}.",
	"RETAINED.readAgain": "Read again",
	"RETAINED.scenario.title": "What if",
	"RETAINED.scenario.noDiscovery": "Saved what-ifs cannot be listed or opened here yet.",
	"RETAINED.scenario.readbackNote": "A saved answer chosen from a conversation still opens here as before.",
	"RETAINED.scenario.loading": "Reading this saved what-if with your current workspace access.",
	"RETAINED.scenario.unavailable": "This saved what-if is unavailable. Nothing from an earlier read is kept.",
	"RETAINED.scenario.transport": "Saved what-ifs are not available in this interface yet. Nothing was read.",
	"RETAINED.scenario.changed": "This saved what-if changed since it was shown. Nothing from the earlier read is kept.",
	"RETAINED.scenario.checking": "Checking that this saved what-if is unchanged before opening.",
	"RETAINED.scenario.identity": "Scenario {scenario}. Revision {revision}, created {createdAt}.",
	"RETAINED.scenario.revisionCue": "Revision {revision}, created {createdAt}.",
	"RETAINED.scenario.historical": "An earlier revision; the head moved on. Nothing was recomputed.",
	"RETAINED.scenario.current": "This is the current revision.",
	"RETAINED.scenario.complete": "Every analysis is ready. Coverage gaps stay in each receipt.",
	"RETAINED.scenario.partial": "Some analyses are not ready. Missing figures are never zero.",
	"RETAINED.scenario.noAction": "Nothing in the books changes; no action is granted.",
	"RETAINED.scenario.historicalDetail": "This is an earlier revision. The current head is {head}. Nothing was recomputed; the figures are those issued for this revision.",
	"RETAINED.scenario.currentDetail": "This revision is the current head. Reading it recomputed nothing.",
	"RETAINED.scenario.completeDetail": "Every analysis is ready. Each receipt keeps its own coverage gaps and limitations.",
	"RETAINED.scenario.partialDetail": "Some analyses are not ready. Their figures are not shown, and nothing is treated as zero.",
	"RETAINED.scenario.noActionDetail": "This comparison changes nothing in the books and grants no action.",
	"RETAINED.scenario.chartSentence": "{figure} for each option, as the embedded receipts state it.",
	"RETAINED.scenario.chartUnavailable": "No chart; no comparable figure.",
	"RETAINED.scenario.columnBaseline": "Your books",
	"RETAINED.scenario.columnAlternative": "With the change",
	"RETAINED.scenario.assumption": "Price change {bps} basis points",
	"RETAINED.scenario.assumptionChange": "Price change: {before} to {after} basis points",
	"RETAINED.scenario.job.pending": "not run yet",
	"RETAINED.scenario.job.stale": "stale, needs a fresh run",
	"RETAINED.scenario.job.running": "running",
	"RETAINED.scenario.job.ready": "ready",
	"RETAINED.scenario.job.retainedRun": "Earlier results, not current.",
	"RETAINED.scenario.retainedRunDetail": "An earlier result is retained under run {run}. It is not current and is not shown as a figure.",
	"RETAINED.scenario.job.reused": "Reused unchanged from revision {revision}.",
	"RETAINED.scenario.comparisons": "Finalized comparison",
	"RETAINED.scenario.comparisonNone": "No finalized comparison is retained.",
	"RETAINED.scenario.comparisonCue": "Finalized comparison retained; dates and limitations are in Exact provenance.",
	"RETAINED.scenario.comparisonDigest": "Comparison digest",
	"RETAINED.scenario.requiredJobs": "Required analyses",
	"RETAINED.scenario.runRevision": "Run revision",
	"RETAINED.scenario.receiptId": "Receipt",
	"RETAINED.scenario.comparison": "Comparison {id}, finalized {createdAt}.",
	"RETAINED.scenario.limitations": "Limitations, as the Engine states them",
	"RETAINED.scenario.provenance": "Exact provenance",
	"RETAINED.scenario.revisionMode": "Revision kind",
	"RETAINED.scenario.parentRevision": "Parent revision",
	"RETAINED.scenario.headRevision": "Current head revision",
	"RETAINED.scenario.revisionDigest": "Revision digest",
	"RETAINED.scenario.evidenceDigest": "Evidence digest",
	"RETAINED.scenario.jobsHeading": "Analyses",
	"RETAINED.scenario.requestDigest": "Request digest",
	"RETAINED.scenario.inputDigest": "Input digest",
	"RETAINED.scenario.dependsOn": "Depends on",
	"RETAINED.scenario.jobState": "State",
	"RETAINED.scenario.activeRun": "Active run",
	"RETAINED.scenario.retainedRunId": "Earlier retained run",
	"RETAINED.scenario.reusedFrom": "Reused from revision",
	"RETAINED.proof.kind": "What-if receipt",
	"RETAINED.proof.note": "This receipt comes from the fresh read of this saved what-if.",
	"RETAINED.proof.unavailable": "This proof is no longer available. Read the saved what-if again.",
	"RETAINED.proof.branch": "Branch",
	"RETAINED.proof.assumption": "Assumption",
	"RETAINED.proof.jobLabel": "Analysis",
	"RETAINED.proof.job": "Analysis identity",
	"RETAINED.proof.run": "Run",
	"RETAINED.proof.runDigest": "Run digest",
	"RETAINED.proof.receiptDigest": "Receipt digest",
	"RETAINED.proof.resultDigest": "Result digest",
	"RETAINED.proof.revision": "Revision",
	"RETAINED.proof.evidence": "Evidence",
	"RETAINED.lesson.title": "Proposed lessons",
	"RETAINED.lesson.note": "Released lessons, five at a time in the order they were released, each with its current standing. Approving records personal guidance only. It changes no meaning, recipe or calculation, and sends nothing anywhere.",
	"RETAINED.lesson.loading": "Reading proposed lessons with your current workspace access.",
	"RETAINED.lesson.empty": "No lessons are released for review right now. This does not say whether any lessons are retained.",
	"RETAINED.lesson.page": "Lessons {from} to {to} of {total}, in the order they were released.",
	"RETAINED.lesson.pageEarlier": "Previous five",
	"RETAINED.lesson.pageLater": "Next five",
	"RETAINED.lesson.unavailable": "Proposed lessons are unavailable. Nothing from an earlier read is kept.",
	"RETAINED.lesson.transport": "Lesson review is not available in this interface yet. Nothing was read.",
	"RETAINED.lesson.cancelled": "Nothing was sent. Open the lesson again to decide.",
	"RETAINED.lesson.uncertain": "Your decision may or may not have been recorded. It was not sent again. Read again before deciding.",
	"RETAINED.lesson.changed": "This lesson changed before your decision was sent. Nothing was sent. Review it again.",
	"RETAINED.lesson.deciding": "Sending your decision once.",
	"RETAINED.lesson.sheet": "Proposed lesson",
	"RETAINED.lesson.sheetUnavailable": "This lesson is no longer open for review here.",
	"RETAINED.lesson.row": "Would change {kind} {target}. Evidence: {count, plural, one {# item} other {# items}}.",
	"RETAINED.lesson.rowStatus": "{status}. Would change {kind} {target}. Evidence: {count, plural, one {# item} other {# items}}.",
	"RETAINED.lesson.role.owner": "owner",
	"RETAINED.lesson.role.cofounder": "cofounder",
	"RETAINED.lesson.role.accountant": "accountant",
	"RETAINED.lesson.role.viewer": "viewer",
	"RETAINED.lesson.status.proposed": "proposed, not yet evaluated",
	"RETAINED.lesson.status.evaluation-blocked": "evaluation blocked",
	"RETAINED.lesson.status.review-ready": "ready for your review",
	"RETAINED.lesson.status.approved": "approved",
	"RETAINED.lesson.status.rejected": "rejected",
	"RETAINED.lesson.status.deferred": "not now",
	"RETAINED.lesson.status.retired": "retired",
	"RETAINED.lesson.status.superseded": "superseded",
	"RETAINED.lesson.kind.personal-preference": "personal preference",
	"RETAINED.lesson.kind.reminder-timing": "reminder timing",
	"RETAINED.lesson.kind.shortlist-order": "shortlist order",
	"RETAINED.lesson.statusName": "Status",
	"RETAINED.lesson.kindName": "Kind of guidance",
	"RETAINED.lesson.rationale": "Why",
	"RETAINED.lesson.change": "What it would change",
	"RETAINED.lesson.target": "Target",
	"RETAINED.lesson.targetValue": "Configured value now",
	"RETAINED.lesson.targetPin": "Target pin",
	"RETAINED.lesson.owner": "Owner",
	"RETAINED.lesson.evidence": "Evidence",
	"RETAINED.lesson.evidence.kind.job": "Job",
	"RETAINED.lesson.evidence.kind.calculation": "Calculation",
	"RETAINED.lesson.evidence.standing": "Standing",
	"RETAINED.lesson.evidence.available": "available",
	"RETAINED.lesson.evidence.unavailable": "unavailable",
	"RETAINED.lesson.evidence.tainted": "source marked tainted",
	"RETAINED.lesson.evidence.clean": "source not marked tainted",
	"RETAINED.lesson.sourceTaint": "Source taint",
	"RETAINED.lesson.sources": "Sources",
	"RETAINED.lesson.branches": "Branches",
	"RETAINED.lesson.markings": "Source markings",
	"RETAINED.lesson.marking": "{source}: {marking}",
	"RETAINED.lesson.scope": "Where it applies",
	"RETAINED.lesson.member": "Member",
	"RETAINED.lesson.conditions": "Conditions",
	"RETAINED.lesson.counterexamples": "Where it does not apply",
	"RETAINED.lesson.evaluation": "Evaluation",
	"RETAINED.lesson.evaluation.none": "No evaluation is bound. Approve and Not now are unavailable.",
	"RETAINED.lesson.evaluation.open": "Open set",
	"RETAINED.lesson.evaluation.hidden": "Hidden set",
	"RETAINED.lesson.evaluation.status": "Run status",
	"RETAINED.lesson.evaluation.status.complete": "complete",
	"RETAINED.lesson.evaluation.status.incomplete": "incomplete",
	"RETAINED.lesson.evaluation.status.declined": "declined",
	"RETAINED.lesson.qualification.synthetic-protocol": "Synthetic protocol: lifecycle verification only, not a real hidden-suite result.",
	"RETAINED.lesson.qualification.owner-qualified": "Owner qualified, as designated by the installed evaluation owner.",
	"RETAINED.lesson.authority": "Authority",
	"RETAINED.lesson.comparison": "Comparison",
	"RETAINED.lesson.completedAt": "Completed at",
	"RETAINED.lesson.baselineDigest": "Guidance-off baseline digest",
	"RETAINED.lesson.metrics": "Metrics, as supplied",
	"RETAINED.lesson.metric": "{name}: {before} before, {after} after ({direction})",
	"RETAINED.lesson.direction.higher-is-better": "higher is better",
	"RETAINED.lesson.direction.lower-is-better": "lower is better",
	"RETAINED.lesson.pins": "Reference, suite, harness, build and configuration",
	"RETAINED.lesson.reference": "Run reference",
	"RETAINED.lesson.suite": "Suite",
	"RETAINED.lesson.harness": "Harness",
	"RETAINED.lesson.build": "Build",
	"RETAINED.lesson.configuration": "Configuration",
	"RETAINED.lesson.artifact": "{id}, revision {revision}, digest {digest}",
	"RETAINED.lesson.evaluationDigest": "Evaluation digest",
	"RETAINED.lesson.review": "Human review",
	"RETAINED.lesson.review.none": "No current human review token was issued for this lesson. Approve and Not now are unavailable.",
	"RETAINED.lesson.reviewId": "Review",
	"RETAINED.lesson.reviewer": "Reviewer",
	"RETAINED.lesson.reviewedAt": "Issued at",
	"RETAINED.lesson.digest": "Digest",
	"RETAINED.lesson.identity": "Exact identities",
	"RETAINED.lesson.candidate": "Candidate",
	"RETAINED.lesson.candidatePin": "{id}, revision {revision}",
	"RETAINED.lesson.workspace": "Workspace",
	"RETAINED.lesson.proposedBy": "Proposed by",
	"RETAINED.lesson.proposedAt": "Proposed at",
	"RETAINED.lesson.episodes": "Episodes",
	"RETAINED.lesson.supersedes": "Replaces",
	"RETAINED.lesson.actor": "{member}, {role}, epoch {epoch}",
	"RETAINED.lesson.actorPin": "{member}, {role} ({enum}), epoch {epoch}",
	"RETAINED.lesson.reason": "Your reason",
	"RETAINED.lesson.reasonRequired": "Write your reason before Approve or Not now.",
	"RETAINED.lesson.reasonInvalid": "Your reason must be plain text of at most 4000 characters.",
	"RETAINED.lesson.decisionNote": "Approve records this lesson as your personal guidance. Not now defers it. Neither changes a meaning, recipe, calculation or reminder, and nothing is sent anywhere.",
	"RETAINED.lesson.block.status": "Only a lesson ready for review can be decided.",
	"RETAINED.lesson.block.evaluation": "Both evaluations must be complete and untainted before a decision.",
	"RETAINED.lesson.block.review": "No current human review is bound to this evaluation.",
	"RETAINED.lesson.block.reviewer": "This review belongs to another reviewer or owner.",
	"RETAINED.lesson.block.role": "Your role can read lessons. Deciding is for an owner or cofounder.",
	"RETAINED.lesson.block.workspace": "This lesson belongs to another workspace."
}, Mn = {
	"SH-01.wordmark": "chausar",
	"SH-01.rail.label": "जगहें",
	"SH-01.region.page": "पेज",
	"SH-01.region.ask": "सवाल की लाइन",
	"SH-01.region.status": "स्थिति की लाइन",
	"SH-01.count": "{count} आपकी मंज़ूरी के लिए",
	"SH-01.status.keys": "तीर की कुंजियाँ चलाती हैं · Enter खोलता है",
	"SH-01.place.today": "आज",
	"SH-01.place.ask": "पूछें",
	"SH-01.place.work": "काम",
	"SH-01.place.books": "खाते",
	"SH-01.place.reports": "रिपोर्ट",
	"SH-01.place.tools": "औज़ार",
	"SH-01.place.trust": "भरोसा",
	"SH-01.place.more": "और",
	"SH-01.place.company": "कंपनी",
	"SH-01.place.clients": "क्लाइंट",
	"SH-01.sub.today.today": "आज",
	"SH-01.sub.today.activity": "गतिविधि",
	"SH-01.sub.ask.new": "नया",
	"SH-01.sub.ask.saved": "सहेजे हुए",
	"SH-01.sub.ask.decisions": "फ़ैसले",
	"SH-01.sub.ask.checks": "जाँचें",
	"SH-01.sub.ask.notyet": "अभी नहीं",
	"SH-01.sub.ask.plans": "योजनाएँ",
	"SH-01.sub.work.approvals": "मंज़ूरियाँ",
	"SH-01.sub.work.jobs": "जॉब",
	"SH-01.sub.work.actions": "कार्रवाइयाँ",
	"SH-01.sub.work.cando": "यह क्या कर सकता है",
	"SH-01.sub.work.cases": "केस",
	"SH-01.sub.work.agents": "एजेंट",
	"SH-01.sub.work.cosign": "सह-हस्ताक्षर के लिए",
	"SH-01.sub.work.many": "कई क्लाइंट के लिए एक ही कदम",
	"SH-01.sub.work.questions": "क्लाइंट के भेजे सवाल",
	"SH-01.sub.books.sources": "स्रोत",
	"SH-01.sub.books.meanings": "मतलब",
	"SH-01.sub.books.accounts": "खाते",
	"SH-01.sub.books.customers": "ग्राहक",
	"SH-01.sub.books.records": "रिकॉर्ड",
	"SH-01.sub.books.history": "इतिहास",
	"SH-01.sub.books.memory": "याददाश्त",
	"SH-01.sub.books.issues": "समस्याएँ",
	"SH-01.sub.books.companies": "कंपनियाँ",
	"SH-01.sub.reports.packs": "पैक",
	"SH-01.sub.reports.weekahead": "आने वाला हफ़्ता",
	"SH-01.sub.reports.briefs": "ब्रीफ़",
	"SH-01.sub.reports.duedates": "देय तारीखें",
	"SH-01.sub.reports.exports": "एक्सपोर्ट",
	"SH-01.sub.reports.sent": "भेजे गए",
	"SH-01.sub.reports.handover": "महीने के अंत की सौंपनी",
	"SH-01.sub.tools.smallapps": "छोटे ऐप",
	"SH-01.sub.tools.plugins": "प्लगइन",
	"SH-01.sub.tools.assistants": "दूसरे सहायक",
	"SH-01.sub.tools.phone": "फ़ोन",
	"SH-01.sub.tools.planning": "योजना",
	"SH-01.sub.tools.library": "फ़र्म की लाइब्रेरी",
	"SH-01.sub.tools.invite": "क्लाइंट को बुलाएँ",
	"SH-01.sub.trust.rules": "नियम",
	"SH-01.sub.trust.people": "लोग",
	"SH-01.sub.trust.models": "मॉडल",
	"SH-01.sub.trust.network": "नेटवर्क",
	"SH-01.sub.trust.record": "रिकॉर्ड",
	"SH-01.sub.trust.sharing": "साझा करना",
	"SH-01.sub.trust.vault": "तिजोरी",
	"SH-01.sub.trust.access": "पहुँच",
	"SH-01.sub.trust.markings": "निशान",
	"SH-01.sub.trust.retention": "रखने की अवधि",
	"SH-01.sub.trust.channels": "चैनल",
	"SH-01.sub.trust.firmname": "रिपोर्ट पर फ़र्म का नाम",
	"SH-01.sub.company.signin": "साइन-इन",
	"SH-01.sub.company.health": "सेहत",
	"SH-01.sub.company.recovery": "रिकवरी",
	"SH-01.sub.company.keys": "कुंजियाँ",
	"SH-01.sub.company.support": "सपोर्ट की पहुँच",
	"SH-01.sub.company.computers": "कंप्यूटर",
	"SH-01.sub.company.quality": "गुणवत्ता",
	"SH-01.sub.company.build": "बिल्ड",
	"SH-01.sub.company.licence": "लाइसेंस",
	"SH-02.title": "{workspace} बंद है",
	"SH-02.field": "पासफ़्रेज़ या पिन",
	"SH-02.unlock": "खोलें",
	"SH-02.device": "{device} से खोलें",
	"SH-02.forgot": "पासफ़्रेज़ भूल गए?",
	"SH-02.forgot.note": "अपनी रिकवरी किट इस्तेमाल करें।",
	"SH-02.paused": "जब तक Chausar बंद है, स्रोत और AI मॉडल रुके रहते हैं।",
	"SH-02.wrong": "यह पासफ़्रेज़ नहीं है।",
	"SH-02.wait": "बहुत बार कोशिश हुई। {time} पर फिर कोशिश करें।",
	"SH-03.driving": "Chausar {program} चला रहा है। रोकने के लिए Ctrl Shift Esc दबाएँ।",
	"SH-03.driving.action": "रोकें",
	"SH-03.demo-clock": "डेमो घड़ी: {date}।",
	"SH-03.read-only": "{holder} के पास कलम है। यह कंप्यूटर सिर्फ़ पढ़ सकता है।",
	"SH-03.read-only.action": "कलम माँगें",
	"SH-03.sending-closed": "{date} के बैकअप से वापस लाया गया। जब तक {count} कार्रवाइयाँ जाँची नहीं जातीं, भेजना बंद है।",
	"SH-03.sending-closed.action": "उन्हें जाँचें",
	"SH-03.jobs-paused": "जब तक आप Chausar नहीं खोलते, जॉब रुके हैं।",
	"SH-03.update-needed": "यह प्रीव्यू बिल्ड {date} को खत्म हो गया। स्रोत और कार्रवाइयाँ चालू रखने के लिए अपडेट करें।",
	"SH-03.update-needed.action": "अभी अपडेट करें",
	"SH-03.no-connection": "कनेक्शन नहीं है। खातों से जवाब अब भी मिलते हैं। सादे शब्दों के सवाल इंतज़ार में हैं।",
	"SH-04.placeholder": "सवाल पूछें या काम बताएँ",
	"SH-04.placeholder.firm": "क्लाइंट खोजें या काम बताएँ",
	"SH-04.key": "Ctrl K",
	"SH-04.mic": "दबाकर बोलें",
	"SH-04.mic.off": "आवाज़ बंद है। चालू करने के लिए भरोसा, नियम, भेजना खोलें।",
	"SH-04.mic.off.short": "आवाज़ बंद है",
	"SH-04.mic.cost": "{cost} प्रति मिनट",
	"SH-04.listening": "सुन रहा है",
	"SH-04.noModel": "कोई AI मॉडल जुड़ा नहीं है। मेन्यू से एक गणना चुनें।",
	"SH-04.readOnly": "सवाल चलते हैं। काम इंतज़ार में: {holder} के पास कलम है।",
	"SH-04.about": "इसके बारे में: {name}",
	"SH-04.about.clear": "हटाएँ",
	"SH-04.kind.calculation": "गणना",
	"SH-04.kind.customer": "ग्राहक",
	"SH-04.kind.place": "जगह",
	"SH-04.kind.saved": "सहेजा हुआ जवाब",
	"SH-06.open": "वर्कस्पेस, व्यू और भाषा",
	"SH-06.workspaces": "वर्कस्पेस",
	"SH-06.companies": "कंपनियाँ",
	"SH-06.companies.all": "सभी कंपनियाँ",
	"SH-06.view": "व्यू",
	"SH-06.view.simple": "सरल",
	"SH-06.view.guided": "निर्देशित",
	"SH-06.view.books": "खाते",
	"SH-06.language": "भाषा",
	"SH-06.language.en": "English",
	"SH-06.language.hi": "हिंदी",
	"SH-06.lock": "अभी बंद करें",
	"SH-06.about": "इस बिल्ड के बारे में",
	"SH-06.demo": "डेमो",
	"SH-06.real": "असली",
	"TD-01.title": "आपकी मंज़ूरी के लिए",
	"TD-01.worth": "देखने लायक",
	"TD-01.month": "इस महीने",
	"TD-01.earlier": "आज अब तक",
	"TD-01.earlier.none": "आज अभी तक कुछ नहीं हुआ।",
	"TD-01.setup": "सेटअप: {of} में से कदम {step}",
	"TD-01.update": "अपडेट तैयार है। पहले आपका डेटा सहेजा जाता है।",
	"TD-01.folded": "{count} पहले के",
	"TD-02.cash": "आज की नकद बिक्री",
	"TD-02.cash.rupee": "₹",
	"TD-03.col.state": "स्थिति",
	"TD-03.col.what": "क्या",
	"TD-03.col.party": "पार्टी या खाता",
	"TD-03.col.asWritten": "स्रोत में जैसा लिखा है",
	"TD-03.col.amount": "रकम",
	"TD-03.col.since": "कब से",
	"TD-03.col.then": "फिर",
	"TD-03.then.you": "आप तय करें",
	"TD-03.then.owner": "मालिक मंज़ूरी देते हैं",
	"TD-03.then.waiting": "मालिक का इंतज़ार",
	"TD-03.close": "{month} का क्लोज़",
	"WK-02.field": "फ़ील्ड",
	"WK-02.before": "पहले",
	"WK-02.after": "बाद में",
	"WK-02.preparedBy": "{name} ने तैयार किया",
	"WK-02.secondAsk": "पैसे की मंज़ूरी से पहले आपका पासफ़्रेज़, पिन या फ़िंगरप्रिंट पूछा जाता है।",
	"WK-02.prepareOnly": "फ़ाइल और चेकलिस्ट डाउनलोड करें। इसे आप या आपके CA दाखिल करते हैं।",
	"WK-02.readOnly": "{holder} के पास कलम है। इस कंप्यूटर से कुछ मंज़ूर नहीं हो सकता।",
	"WK-02.readOnly.plain": "सिर्फ़ पढ़ने के लिए। इस कंप्यूटर से कुछ मंज़ूर नहीं हो सकता।",
	"WK-02.unsure": "पक्का नहीं कि यह गया। दोबारा कोशिश से पहले जाँच हो रही है।",
	"CA-01.filter": "दिखाएँ",
	"CA-01.filter.needs": "आपकी ज़रूरत",
	"CA-01.filter.notDone": "क्लोज़ बाकी",
	"CA-01.filter.all": "सभी",
	"CA-01.col.client": "क्लाइंट",
	"CA-01.col.read": "खाते पढ़े",
	"CA-01.col.close": "{month} का क्लोज़",
	"CA-01.col.awaiting": "आपके इंतज़ार में",
	"CA-01.col.due": "अगली देय",
	"CA-01.col.open": "खोलें",
	"CA-01.invited": "बुलाया गया, जुड़ा नहीं",
	"CA-01.guide": "गाइड फिर भेजें",
	"CA-01.more": "{count} और",
	"CA-01.legend": "{month} का क्लोज़, क्रम में: बैंक, GST, TDS, ट्रायल बैलेंस",
	"CA-01.vault": "हर क्लाइंट के खाते उसी क्लाइंट की तिजोरी में रहते हैं।",
	"EN.lens": "नज़रिया",
	"EN.lens.whole-group": "पूरा समूह",
	"EN.lens.finance": "वित्त",
	"EN.lens.sales": "बिक्री",
	"EN.lens.operations": "संचालन",
	"EN.whose": "किसके",
	"EN.whose.mine": "मेरे",
	"EN.whose.team": "मेरी टीम",
	"EN.whose.everyone": "सबके",
	"EN.owner": "{name} ने तैयार किया",
	"EN.month": "समूह इस महीने",
	"EN.changed": "{since} से बदला",
	"BTN.review": "देखें",
	"BTN.approve": "मंज़ूर करें",
	"BTN.notNow": "अभी नहीं",
	"BTN.change": "बदलें",
	"BTN.drop": "हटाएँ",
	"BTN.open": "खोलें",
	"BTN.prepare": "तैयार करें",
	"BTN.enter": "दर्ज करें",
	"BTN.continue": "आगे बढ़ें",
	"BTN.update": "अपडेट करें",
	"BTN.close": "बंद करें",
	"BTN.seeAll": "सभी {count} देखें",
	"BTN.download": "फ़ाइल और चेकलिस्ट लें",
	"BTN.check": "फिर जाँचें",
	"BTN.wasSent": "यह भेजा गया",
	"BTN.wasNotSent": "यह नहीं भेजा गया",
	"SHEET.close": "बंद करें · Esc",
	"SHEET.position": "{kind} · {total} में से {index}",
	"SHEET.back": "{what} पर वापस",
	"SHEET.kind.approval": "मंज़ूरी",
	"SHEET.kind.receipt": "रसीद",
	"STEP.prepared": "तैयार",
	"STEP.approve": "मंज़ूरी",
	"STEP.send": "भेजना",
	"STEP.read-back": "पढ़कर मिलान",
	"STEP.recorded": "दर्ज",
	"STEP.you": "आप",
	"STEP.vault": "तिजोरी",
	"STEP.model": "मॉडल",
	"STEP.books": "आपके खाते",
	"STEP.meanings": "मतलब",
	"STEP.first-answer": "पहला जवाब",
	"STEPSTATE.done": "हो गया",
	"STEPSTATE.waiting-for-you": "आपका इंतज़ार",
	"STEPSTATE.waiting-for-network": "नेटवर्क का इंतज़ार",
	"STEPSTATE.unsure": "पक्का नहीं क्या हुआ",
	"STEPSTATE.stopped-by-rule": "नियम ने रोका",
	"STEPSTATE.stopped-by-budget": "बजट ने रोका",
	"STEPSTATE.not-reached": "अभी नहीं पहुँचा",
	"MARK.cha": "Chausar ने किया",
	"MARK.you": "आपका",
	"MARK.wait": "आपकी मंज़ूरी के लिए",
	"MARK.busy": "Chausar की बारी, अभी पूरा नहीं",
	"MARK.unsure": "पक्का नहीं",
	"MARK.guess": "अंदाज़ा, नापा नहीं",
	"MARK.off": "बंद",
	"MISSING.absent": "कुछ नहीं",
	"MISSING.null": "पता नहीं",
	"MISSING.unknown": "पक्का नहीं",
	"MISSING.withheld": "आपकी सीट से छिपा",
	"MISSING.not-applicable": "लागू नहीं",
	"MISSING.not-loaded-yet": "अभी लोड नहीं हुआ",
	"MISSING.not-counted": "गिना नहीं",
	"MISSING.cash-not-captured": "नकद बिक्री दर्ज नहीं",
	"MISSING.not-agreed": "मेल नहीं",
	"MISSING.none": "कुछ नहीं",
	"LABEL.seed": "शुरुआती",
	"LABEL.what-if": "अगर ऐसा हो",
	"LABEL.projection": "अनुमान",
	"LABEL.from-outside": "बाहर से",
	"LABEL.approximate": "लगभग",
	"LABEL.demo-clock": "डेमो घड़ी",
	"LABEL.stale": "पुराना",
	"LABEL.guess": "अंदाज़ा",
	"LABEL.measured": "नापा गया",
	"LABEL.told-by-owner": "मालिक ने बताया",
	"LABEL.assumption": "मान्यता",
	"LABEL.from-data": "डेटा से",
	"LABEL.recorded-later": "बाद में दर्ज",
	"LABEL.late": "देर से",
	"LABEL.practice": "अभ्यास",
	"LABEL.experimental": "प्रायोगिक",
	"LABEL.file": "फ़ाइल",
	"FIGURE.title": "सटीक मान {exact}। रसीद {receipt} खोलता है",
	"FIGURE.spoken": "{spoken}। इसकी रसीद खोलता है",
	"CHART.open": "{label}, {amount} की रसीद खोलें",
	"CHART.hover": "{label}: {amount}",
	"CHART.missing": "{label}: {words}",
	"CHART.unavailable.CHART_NOT_PROVIDED": "चार्ट नहीं है। कोई शृंखला नहीं दी गई।",
	"CHART.unavailable.CHART_FORM_NOT_IMPLEMENTED": "चार्ट नहीं है। चार्ट का यह रूप अभी बना नहीं है।",
	"CHART.unavailable.CHART_HAS_NO_POINTS": "चार्ट नहीं है। शृंखला में कोई बिंदु नहीं है।",
	"CHART.unavailable.CHART_HAS_NO_KNOWN_POINTS": "चार्ट नहीं है। शृंखला का कोई बिंदु पता नहीं है।",
	"CHART.shares.unavailable": "पट्टी नहीं है। ये मान एक पूरे के हिस्सों की तरह नहीं खींचे जा सकते।",
	"STRIP.done": "हो गया",
	"STRIP.loading": "लोड हो रहा है",
	"STRIP.not-done": "बाकी",
	"STRIP.refused": "फ़ाइल नामंज़ूर",
	"STRIP.cell": "{label}: {state}।",
	"TIMELINE.who": "{name} द्वारा",
	"CHOICE.no": "नहीं",
	"CHOICE.yes": "हाँ",
	"ST.loading": "पढ़ रहा है। पिछली बार जो पता था, वह दिख रहा है।",
	"ST.loading.lastKnown": "{time} तक की जानकारी। फिर पढ़ रहा है।",
	"ST.loading.reading": "{what} पढ़ रहा है",
	"ST.empty.review": "आपकी मंज़ूरी के लिए कुछ नहीं है।",
	"ST.empty.sources": "अभी कोई स्रोत नहीं है।",
	"ST.noChange": "{since} से कोई बदलाव नहीं।",
	"ST.noChange.plain": "पिछली बार पढ़ने के बाद कोई बदलाव नहीं।",
	"ST.notEnough.plain": "बताने लायक लोड नहीं हुआ।",
	"ST.readOnly.plain": "कलम दूसरे कंप्यूटर के पास है। यह कंप्यूटर सिर्फ़ पढ़ सकता है।",
	"ST.failed": "कुछ काम नहीं किया। कुछ बदला नहीं गया।",
	"ST.notEnough": "बताने लायक लोड नहीं हुआ। {count, plural, one {{display} महीना} other {{display} महीने}} अभी लोड नहीं हुए।",
	"ST.stale.since": "{date} को निकाला गया, पुराना हो सकता है",
	"ST.rebuild": "फिर बनाएँ",
	"ST.notYet": "अभी नहीं। कोई गणना इसे नहीं ढकती।",
	"ST.notYet.wanted": "यह माँग की सूची में है।",
	"ST.rule": "नियम ने रोका: {rule}",
	"ST.rule.who": "{who} इसे बदल सकते हैं।",
	"ST.failed.code": "कोड {code}",
	"ST.network": "नेटवर्क का इंतज़ार। जिसे नेटवर्क नहीं चाहिए, वह काम चलता रहता है।",
	"ST.readOnly": "{holder} के पास कलम है। यह कंप्यूटर सिर्फ़ पढ़ सकता है।",
	"ST.hidden": "कुछ पंक्तियाँ आपकी सीट से छिपी हैं।",
	"ST.hidden.total": "कुल नहीं दिखाया गया: इससे {count, plural, one {{display} छिपी पंक्ति} other {{display} से कम छिपी पंक्तियाँ}} उजागर होतीं।",
	"ST.refused": "नामंज़ूर: {reason}",
	"ST.locked": "Chausar बंद है।",
	"ST.noAccess": "आपकी भूमिका को इस कार्यस्थान की पहुँच नहीं है।",
	"ST.notBuilt": "अभी बना नहीं है।",
	"ST.notBuilt.day": "अभी बना नहीं है। यह दिन {day} पर आता है।",
	"ST.partial.label": "एक बार चलता दिखा, बेंच पर अभी जाँचा नहीं गया।",
	"ST.partial.plain": "इसका सिर्फ़ एक हिस्सा लोड हुआ है।",
	"ST.stale.plain": "यह पुराना हो सकता है।",
	"ST.rule.plain": "नियम ने रोका।",
	"ST.boundary.reason": "कारण कोड {code}",
	"ST.boundary.asOf": "{asOf} तक की जानकारी",
	"ASK.workspace.empty": "नीचे की लाइन में सवाल पूछें।",
	"ASK.workspace.busy": "इस सवाल पर काम चल रहा है।",
	"ASK.workspace.review": "देखें कि क्या भेजा जाएगा।",
	"ASK.workspace.continuation": "स्पष्टीकरण का जवाब सवाल की लाइन में दें।",
	"ASK.workspace.unavailable": "यह जवाब उपलब्ध नहीं है। कोड {code}।",
	"ASK.consent.kind": "AI मॉडल को अनुरोध",
	"ASK.consent.planning.title": "अपना सवाल AI मॉडल को भेजें",
	"ASK.consent.planning.note": "एक बार भेजें सिर्फ़ इसी एक अनुरोध की इजाज़त देता है, ठीक जैसा यहाँ दिख रहा है। जवाब को शब्दों में लिखवाना एक अलग अनुरोध है, और उसके लिए आपसे फिर पूछा जाता है।",
	"ASK.consent.planning.send": "एक बार भेजें",
	"ASK.consent.final-writing.title": "नतीजे लिखवाने के लिए भेजें",
	"ASK.consent.final-writing.note": "एक बार लिखवाएँ सिर्फ़ इसी एक अनुरोध की इजाज़त देता है, ठीक जैसा यहाँ दिख रहा है। यह उस अनुरोध से अलग है जिसकी इजाज़त आपने पहले दी थी।",
	"ASK.consent.final-writing.send": "एक बार लिखवाएँ",
	"ASK.consent.cancel": "रद्द करें",
	"ASK.consent.mismatch.title": "यह समीक्षा भेजी नहीं जा सकती",
	"ASK.consent.mismatch": "यह समीक्षा अपने कदम से मेल नहीं खाती, इसलिए भेजने को कुछ नहीं है। इसे बंद करें और फिर पूछें।",
	"ASK.consent.question": "आपका सवाल, जैसा लिखा है",
	"ASK.consent.warning.question": "आपके सवाल के बारे में",
	"ASK.consent.warning.definition": "आपकी गणनाओं की परिभाषाओं के बारे में",
	"ASK.consent.warning.calculation": "आपकी गणना के लिए दिए गए मानों के बारे में",
	"ASK.consent.warning.continuation": "पहले की बातचीत के बारे में",
	"ASK.consent.warning.synthesis": "भेजे जा रहे नतीजों के बारे में",
	"ASK.consent.disclosure.question": "पूरा सवाल साक्ष्य की संरचना (Shape) से अलग शामिल है। भेजने की अनुमति देने से पहले इसमें निजी नामों, रकमों और निर्देशों की जाँच करें।",
	"ASK.consent.disclosure.definition": "प्रकाशित गणनाओं के नाम, परिभाषाएँ और पैरामीटरों के अर्थ साक्ष्य की संरचना (Shape) से अलग शामिल हैं। यहाँ दिख रहे ठीक इसी पूरे भेजे जाने वाले पाठ की अनुमति देने से पहले परिभाषाओं के पाठ में निजी नामों, रकमों और निर्देशों की जाँच करें।",
	"ASK.consent.disclosure.continuation": "सहेजा गया पूरा मूल उद्देश्य, स्पष्टीकरण और पहले की सभी बातचीत, आपके वर्तमान जवाब के ठीक उसी पाठ के साथ, साक्ष्य की संरचना (Shape) से अलग शामिल हैं। ठीक इसी पूरे भेजे जाने वाले पाठ की अनुमति देने से पहले पिछले सभी पाठों में निजी नामों, रकमों और निर्देशों की जाँच करें।",
	"ASK.consent.disclosure.synthesis": "सहेजे गए मूल उद्देश्य का ठीक वही पाठ, स्वीकार किए गए दावों का पाठ और औज़ारों से तैयार किया गया सारांश साक्ष्य की संरचना (Shape) से अलग शामिल हैं। अंतिम जवाब लिखवाने के इस अलग अनुरोध को एक बार भेजने की अनुमति देने से पहले निजी नामों, कारोबार की जानकारी और निर्देशों की जाँच करें।",
	"ASK.consent.disclosure.original": "इंजन की मूल चेतावनी, ज्यों की त्यों",
	"ASK.consent.earlier": "इसके साथ भेजी जा रही पहले की बातचीत",
	"ASK.consent.earlier.question": "मूल सवाल",
	"ASK.consent.earlier.clarification": "माँगा गया स्पष्टीकरण",
	"ASK.consent.earlier.exchanges": "अब तक की बातचीत",
	"ASK.consent.exchange.question": "सवाल",
	"ASK.consent.exchange.clarification": "स्पष्टीकरण",
	"ASK.consent.details": "यह कहाँ जाता है",
	"ASK.consent.route": "रूट",
	"ASK.consent.endpoint": "पता",
	"ASK.consent.endpoint.unknown": "मालूम नहीं। इस रूट ने कोई पता नहीं बताया।",
	"ASK.consent.level": "भेजने का स्तर",
	"ASK.consent.level.shape": "सिर्फ़ ढाँचा",
	"ASK.consent.level.samples": "नमूने",
	"ASK.consent.boundary": "यह कैसे जाता है",
	"ASK.consent.boundary.application-to-provider-http": "इस ऐप से सीधे मॉडल देने वाली कंपनी को",
	"ASK.consent.boundary.application-to-official-cli": "इस ऐप से मॉडल देने वाली कंपनी के अपने टूल को",
	"ASK.consent.observed": "रसीद में क्या दर्ज होता है",
	"ASK.consent.observed.yes": "अनुरोध, जैसा यह ऐप उसे कंपनी को भेजता है।",
	"ASK.consent.observed.no": "सिर्फ़ वह जो यह ऐप टूल को सौंपता है। टूल आगे अपनी कंपनी को क्या भेजता है, यह ऐप नहीं देखता।",
	"ASK.consent.preview": "पूर्वावलोकन",
	"ASK.consent.digest": "इस पाठ का डाइजेस्ट",
	"ASK.consent.continuation.id": "पहले की बातचीत",
	"ASK.consent.continuation.digest": "पहले की बातचीत का डाइजेस्ट",
	"ASK.consent.synthesis.turn": "जाँचे हुए नतीजे",
	"ASK.consent.synthesis.digest": "नतीजों के सार का डाइजेस्ट",
	"ASK.consent.payload": "भेजा जाने वाला ठीक यही पाठ",
	"ASK.answer.clarification": "AI मॉडल को पहले एक बात जाननी है",
	"ASK.answer.continue": "इसका जवाब दें",
	"ASK.answer.written": "AI मॉडल ने जाँचे हुए नतीजों से लिखा",
	"ASK.answer.cautions": "सावधानियाँ",
	"ASK.answer.tools": "जाँचे हुए नतीजे",
	"ASK.answer.tool.business": "कारोबार के बारे में",
	"ASK.answer.tool.calculation": "गणना",
	"ASK.answer.tool.error": "इस कदम से कोई नतीजा नहीं मिला।",
	"ASK.answer.previewWriting": "लिखने से पहले देखें",
	"ASK.answer.previewWriting.note": "यह सिर्फ़ दिखाता है कि AI मॉडल को क्या भेजा जाएगा। जब तक आप देखकर भेजना न चुनें, कुछ नहीं भेजा जाता।",
	"ASK.answer.saved.id": "सहेजा हुआ जवाब",
	"ASK.answer.saved.at": "सहेजने का समय",
	"ASK.answer.notSpecified": "बताया नहीं गया",
	"ASK.answer.status": "स्थिति",
	"ASK.answer.sources": "स्रोत",
	"ASK.answer.contextDigest": "संदर्भ का डाइजेस्ट",
	"ASK.answer.modelReceipt": "मॉडल की रसीद",
	"ASK.answer.toolReceipt": "टूल की रसीद",
	"ASK.answer.savedAnswer.business": "कारोबार का सहेजा हुआ जवाब",
	"ASK.answer.savedAnswer.calculation": "गणना का सहेजा हुआ जवाब",
	"ASK.answer.calculationReceipt": "गणना की रसीद",
	"ASK.answer.businessReceipt": "कारोबार के संदर्भ की रसीद",
	"ASK.answer.synthesisReceipt": "लिखाई की रसीद",
	"ASK.answer.synthesisReceipt.id": "रसीद",
	"ASK.answer.synthesisReceipt.toolTurn": "इस्तेमाल हुए जाँचे नतीजे",
	"ASK.answer.synthesisReceipt.planner": "योजना की मॉडल रसीद",
	"ASK.answer.synthesisReceipt.writer": "लिखाई की मॉडल रसीद",
	"ASK.answer.synthesisReceipt.input": "इनपुट डाइजेस्ट",
	"ASK.answer.synthesisReceipt.output": "आउटपुट डाइजेस्ट",
	"ASK.answer.refs.evidence": "सबूत",
	"ASK.answer.refs.answers": "जवाब",
	"ASK.answer.refs.receipts": "रसीदें",
	"ASK.answer.refs.citations": "हवाले",
	"ASK.answer.business.status.grounded": "स्थापित",
	"ASK.answer.business.status.partial": "कुछ हद तक स्थापित",
	"ASK.answer.business.status.unknown": "स्थापित नहीं",
	"ASK.answer.business.claims": "कथन",
	"ASK.answer.business.unknowns": "जो पता नहीं",
	"ASK.answer.business.conflicts": "टकराव",
	"ASK.answer.business.limitations": "इस जवाब की सीमाएँ",
	"ASK.answer.business.citations": "दिए गए हवाले",
	"ASK.answer.category.workspace": "वर्कस्पेस",
	"ASK.answer.category.definitions": "परिभाषाएँ",
	"ASK.answer.category.records": "रिकॉर्ड",
	"ASK.answer.category.industry": "उद्योग",
	"ASK.answer.category.products": "उत्पाद",
	"ASK.answer.category.customers": "ग्राहक",
	"ASK.answer.category.business_model": "कारोबार का तरीका",
	"ASK.answer.category.location": "जगह",
	"ASK.answer.origin.workspace-metadata": "वर्कस्पेस का ब्योरा",
	"ASK.answer.origin.published-definition": "प्रकाशित परिभाषा",
	"ASK.answer.origin.source-observation": "स्रोत में देखा गया",
	"ASK.answer.origin.owner-told": "मालिक ने बताया",
	"ASK.answer.origin.draft-assumption": "मसौदा मान्यता",
	"ASK.answer.qualification.metadata-only": "सिर्फ़ ब्योरा",
	"ASK.answer.qualification.unqualified-observation": "देखा गया, पुष्टि नहीं",
	"ASK.answer.qualification.evidence-qualified": "सबूत से समर्थित",
	"ASK.answer.qualification.owner-stated": "मालिक का कथन",
	"ASK.answer.qualification.draft": "मसौदा",
	"ASK.answer.citation": "हवाला",
	"ASK.answer.citation.kind": "प्रकार",
	"ASK.answer.citation.kind.workspace": "वर्कस्पेस",
	"ASK.answer.citation.kind.dictionary": "शब्दकोश",
	"ASK.answer.citation.kind.fact": "तथ्य",
	"ASK.answer.citation.kind.profile": "प्रोफ़ाइल",
	"ASK.answer.citation.path": "पथ",
	"ASK.answer.citation.source": "स्रोत",
	"ASK.answer.citation.row": "स्रोत की पंक्ति",
	"ASK.answer.citation.validFrom": "कब से मान्य",
	"ASK.answer.citation.validTo": "कब तक मान्य",
	"ASK.answer.citation.learnedAt": "कब जाना गया",
	"ASK.answer.scope.corpus": "पढ़े गए सबूत",
	"ASK.answer.scope.corpus.currently-authorized-local-evidence": "स्थानीय सबूत, जो आप अभी पढ़ सकते हैं",
	"ASK.answer.scope.completeness": "पूर्णता",
	"ASK.answer.scope.completeness.bounded": "सीमित, पूरा नहीं",
	"ASK.answer.scope.branch": "शाखा",
	"ASK.answer.scope.asOf": "इस समय तक की जानकारी",
	"ASK.answer.scope.onDate": "तारीख",
	"ASK.answer.scope.synthetic": "अभ्यास का डेटा",
	"ASK.answer.calculation.operation": "क्रिया",
	"ASK.answer.calculation.period": "अवधि",
	"ASK.answer.calculation.comparePeriod": "किससे तुलना",
	"ASK.answer.calculation.currency": "मुद्रा",
	"ASK.answer.calculation.requestedSources": "माँगे गए स्रोत",
	"ASK.answer.calculation.noFigures": "इस रसीद में कोई आँकड़ा नहीं है।",
	"ASK.answer.period": "{from} से {to}",
	"ASK.answer.coverage.completeness": "कवरेज",
	"ASK.answer.coverage.completeness.reconciled-imports": "इंपोर्ट का मिलान हुआ",
	"ASK.answer.coverage.completeness.unreconciled-facts": "रिकॉर्ड का मिलान नहीं हुआ",
	"ASK.answer.coverage.completeness.empty": "कुछ गिना नहीं गया",
	"ASK.answer.coverage.completeness.partial": "आंशिक",
	"ASK.answer.coverage.selected": "चुनी गई पंक्तियाँ",
	"ASK.answer.coverage.counted": "गिनी गई पंक्तियाँ",
	"ASK.answer.coverage.excluded": "छोड़ी गई पंक्तियाँ",
	"ASK.answer.coverage.conflicts": "अनसुलझे टकराव",
	"ASK.answer.coverage.gaps": "कवरेज की कमियाँ",
	"ASK.answer.figure.money.currency": "सटीक मान {exact}, {currency} की सबसे छोटी इकाई में।",
	"ASK.answer.figure.money": "सटीक मान {exact}, सबसे छोटी इकाई में।",
	"ASK.answer.figure.points.currency": "सटीक मान {exact} बेसिस पॉइंट। मुद्रा {currency}।",
	"ASK.answer.figure.points": "सटीक मान {exact} बेसिस पॉइंट।",
	"ASK.answer.calculation.figure": "आँकड़ा",
	"ASK.answer.detail.calculation": "दायरा, कवरेज और रसीद",
	"ASK.answer.detail.business": "दायरा और रसीदें",
	"ASK.answer.detail.turn": "रसीदें और सहेजे हुए जवाब",
	"ASK.answer.detail.saved": "इस सहेजे हुए जवाब के बारे में",
	"ASK.answer.figure.open": "{label}: {display}। {exact} गणना की रसीद {receipt} खोलता है।",
	"RETAINED.readAgain": "फिर से पढ़ें",
	"RETAINED.scenario.title": "अगर ऐसा हो",
	"RETAINED.scenario.noDiscovery": "सहेजे हुए अगर-ऐसा-हो अभी यहाँ न सूचीबद्ध हो सकते हैं, न खोले जा सकते हैं।",
	"RETAINED.scenario.readbackNote": "बातचीत से चुना गया सहेजा हुआ जवाब पहले की तरह यहीं खुलता है।",
	"RETAINED.scenario.loading": "आपकी मौजूदा कार्यक्षेत्र पहुँच के साथ यह सहेजा हुआ अगर-ऐसा-हो पढ़ा जा रहा है।",
	"RETAINED.scenario.unavailable": "यह सहेजा हुआ अगर-ऐसा-हो उपलब्ध नहीं है। पहले पढ़ी गई कोई बात नहीं रखी गई है।",
	"RETAINED.scenario.transport": "सहेजे हुए अगर-ऐसा-हो अभी इस इंटरफ़ेस में उपलब्ध नहीं हैं। कुछ पढ़ा नहीं गया।",
	"RETAINED.scenario.changed": "दिखाए जाने के बाद यह सहेजा हुआ अगर-ऐसा-हो बदल गया। पहले पढ़ी गई कोई बात नहीं रखी गई है।",
	"RETAINED.scenario.checking": "खोलने से पहले जाँचा जा रहा है कि यह सहेजा हुआ अगर-ऐसा-हो बदला नहीं है।",
	"RETAINED.scenario.identity": "परिदृश्य {scenario}। संस्करण {revision}, बनाया गया {createdAt}।",
	"RETAINED.scenario.revisionCue": "संस्करण {revision}, बनाया गया {createdAt}।",
	"RETAINED.scenario.historical": "यह पुराना संस्करण है; शीर्ष आगे बढ़ चुका है। कुछ दोबारा नहीं गिना गया।",
	"RETAINED.scenario.current": "यह मौजूदा संस्करण है।",
	"RETAINED.scenario.complete": "हर विश्लेषण तैयार है। कवरेज की कमियाँ हर रसीद में हैं।",
	"RETAINED.scenario.partial": "कुछ विश्लेषण तैयार नहीं हैं। छूटे आँकड़े कभी शून्य नहीं होते।",
	"RETAINED.scenario.noAction": "बहीखाते में कुछ नहीं बदलता; कोई कार्रवाई नहीं दी जाती।",
	"RETAINED.scenario.historicalDetail": "यह एक पुराना संस्करण है। मौजूदा शीर्ष {head} है। कुछ दोबारा नहीं गिना गया; आँकड़े वही हैं जो इस संस्करण के लिए जारी हुए थे।",
	"RETAINED.scenario.currentDetail": "यह संस्करण ही मौजूदा शीर्ष है। इसे पढ़ने में कुछ दोबारा नहीं गिना गया।",
	"RETAINED.scenario.completeDetail": "हर विश्लेषण तैयार है। हर रसीद अपनी कवरेज की कमियाँ और सीमाएँ अपने साथ रखती है।",
	"RETAINED.scenario.partialDetail": "कुछ विश्लेषण तैयार नहीं हैं। उनके आँकड़े नहीं दिखाए गए हैं, और किसी को शून्य नहीं माना गया है।",
	"RETAINED.scenario.noActionDetail": "यह तुलना बहीखाते में कुछ नहीं बदलती और कोई कार्रवाई नहीं देती।",
	"RETAINED.scenario.chartSentence": "हर विकल्प के लिए {figure}, जैसा जुड़ी रसीदें बताती हैं।",
	"RETAINED.scenario.chartUnavailable": "कोई चार्ट नहीं; कोई तुलनीय आँकड़ा नहीं।",
	"RETAINED.scenario.columnBaseline": "आपका बहीखाता",
	"RETAINED.scenario.columnAlternative": "बदलाव के साथ",
	"RETAINED.scenario.assumption": "दाम में बदलाव {bps} आधार अंक",
	"RETAINED.scenario.assumptionChange": "दाम में बदलाव: {before} से {after} आधार अंक",
	"RETAINED.scenario.job.pending": "अभी चला नहीं",
	"RETAINED.scenario.job.stale": "पुराना, नई गणना चाहिए",
	"RETAINED.scenario.job.running": "चल रहा है",
	"RETAINED.scenario.job.ready": "तैयार",
	"RETAINED.scenario.job.retainedRun": "पुराने नतीजे, मौजूदा नहीं।",
	"RETAINED.scenario.retainedRunDetail": "एक पुराना नतीजा रन {run} के तहत रखा है। यह मौजूदा नहीं है और आँकड़े की तरह नहीं दिखाया गया है।",
	"RETAINED.scenario.job.reused": "संस्करण {revision} से बिना बदलाव दोबारा इस्तेमाल किया गया।",
	"RETAINED.scenario.comparisons": "अंतिम तुलना",
	"RETAINED.scenario.comparisonNone": "कोई अंतिम तुलना नहीं रखी गई है।",
	"RETAINED.scenario.comparisonCue": "अंतिम तुलना रखी गई है; तारीखें और सीमाएँ सटीक उद्गम में हैं।",
	"RETAINED.scenario.comparisonDigest": "तुलना डाइजेस्ट",
	"RETAINED.scenario.requiredJobs": "आवश्यक विश्लेषण",
	"RETAINED.scenario.runRevision": "रन का संस्करण",
	"RETAINED.scenario.receiptId": "रसीद",
	"RETAINED.scenario.comparison": "तुलना {id}, अंतिम रूप {createdAt} को।",
	"RETAINED.scenario.limitations": "सीमाएँ, जैसा इंजन बताता है",
	"RETAINED.scenario.provenance": "सटीक उद्गम",
	"RETAINED.scenario.revisionMode": "संस्करण का प्रकार",
	"RETAINED.scenario.parentRevision": "पिछला संस्करण",
	"RETAINED.scenario.headRevision": "मौजूदा शीर्ष संस्करण",
	"RETAINED.scenario.revisionDigest": "संस्करण डाइजेस्ट",
	"RETAINED.scenario.evidenceDigest": "साक्ष्य डाइजेस्ट",
	"RETAINED.scenario.jobsHeading": "विश्लेषण",
	"RETAINED.scenario.requestDigest": "अनुरोध डाइजेस्ट",
	"RETAINED.scenario.inputDigest": "इनपुट डाइजेस्ट",
	"RETAINED.scenario.dependsOn": "किस पर निर्भर",
	"RETAINED.scenario.jobState": "स्थिति",
	"RETAINED.scenario.activeRun": "चालू रन",
	"RETAINED.scenario.retainedRunId": "पुराना रखा हुआ रन",
	"RETAINED.scenario.reusedFrom": "किस संस्करण से दोबारा इस्तेमाल",
	"RETAINED.proof.kind": "अगर-ऐसा-हो रसीद",
	"RETAINED.proof.note": "यह रसीद इस सहेजे हुए अगर-ऐसा-हो की ताज़ा पढ़ाई से आई है।",
	"RETAINED.proof.unavailable": "यह प्रमाण अब उपलब्ध नहीं है। सहेजा हुआ अगर-ऐसा-हो फिर से पढ़ें।",
	"RETAINED.proof.branch": "शाखा",
	"RETAINED.proof.assumption": "मान्यता",
	"RETAINED.proof.jobLabel": "विश्लेषण",
	"RETAINED.proof.job": "विश्लेषण की पहचान",
	"RETAINED.proof.run": "रन",
	"RETAINED.proof.runDigest": "रन डाइजेस्ट",
	"RETAINED.proof.receiptDigest": "रसीद डाइजेस्ट",
	"RETAINED.proof.resultDigest": "नतीजे का डाइजेस्ट",
	"RETAINED.proof.revision": "संस्करण",
	"RETAINED.proof.evidence": "साक्ष्य",
	"RETAINED.lesson.title": "प्रस्तावित सीख",
	"RETAINED.lesson.note": "जारी की गई सीखें, जारी होने के क्रम में एक बार में पाँच, हर एक अपनी मौजूदा स्थिति के साथ। मंज़ूरी देने से सिर्फ़ निजी मार्गदर्शन दर्ज होता है। इससे कोई अर्थ, नुस्खा या गणना नहीं बदलती, और कहीं कुछ नहीं भेजा जाता।",
	"RETAINED.lesson.loading": "आपकी मौजूदा कार्यक्षेत्र पहुँच के साथ प्रस्तावित सीख पढ़ी जा रही हैं।",
	"RETAINED.lesson.empty": "अभी समीक्षा के लिए कोई सीख जारी नहीं है। इससे यह नहीं पता चलता कि कोई सीख रखी गई है या नहीं।",
	"RETAINED.lesson.page": "{total} में से सीख {from} से {to}, जारी होने के क्रम में।",
	"RETAINED.lesson.pageEarlier": "पिछली पाँच",
	"RETAINED.lesson.pageLater": "अगली पाँच",
	"RETAINED.lesson.unavailable": "प्रस्तावित सीख उपलब्ध नहीं हैं। पहले पढ़ी गई कोई बात नहीं रखी गई है।",
	"RETAINED.lesson.transport": "सीख की समीक्षा अभी इस इंटरफ़ेस में उपलब्ध नहीं है। कुछ पढ़ा नहीं गया।",
	"RETAINED.lesson.cancelled": "कुछ नहीं भेजा गया। निर्णय लेने के लिए सीख फिर से खोलें।",
	"RETAINED.lesson.uncertain": "आपका निर्णय दर्ज हुआ भी हो सकता है, नहीं भी। इसे दोबारा नहीं भेजा गया। निर्णय लेने से पहले फिर से पढ़ें।",
	"RETAINED.lesson.changed": "आपका निर्णय भेजे जाने से पहले यह सीख बदल गई। कुछ नहीं भेजा गया। इसे फिर से देखें।",
	"RETAINED.lesson.deciding": "आपका निर्णय एक बार भेजा जा रहा है।",
	"RETAINED.lesson.sheet": "प्रस्तावित सीख",
	"RETAINED.lesson.sheetUnavailable": "यह सीख अब यहाँ समीक्षा के लिए खुली नहीं है।",
	"RETAINED.lesson.row": "{kind} {target} बदलेगी। साक्ष्य: {count, plural, one {# मद} other {# मदें}}।",
	"RETAINED.lesson.rowStatus": "{status}। {kind} {target} बदलेगी। साक्ष्य: {count, plural, one {# मद} other {# मदें}}।",
	"RETAINED.lesson.role.owner": "मालिक",
	"RETAINED.lesson.role.cofounder": "सह-संस्थापक",
	"RETAINED.lesson.role.accountant": "लेखाकार",
	"RETAINED.lesson.role.viewer": "दर्शक",
	"RETAINED.lesson.status.proposed": "प्रस्तावित, अभी मूल्यांकन नहीं हुआ",
	"RETAINED.lesson.status.evaluation-blocked": "मूल्यांकन रुका हुआ",
	"RETAINED.lesson.status.review-ready": "आपकी समीक्षा के लिए तैयार",
	"RETAINED.lesson.status.approved": "मंज़ूर",
	"RETAINED.lesson.status.rejected": "अस्वीकृत",
	"RETAINED.lesson.status.deferred": "अभी नहीं",
	"RETAINED.lesson.status.retired": "हटाई गई",
	"RETAINED.lesson.status.superseded": "बदली गई",
	"RETAINED.lesson.kind.personal-preference": "निजी पसंद",
	"RETAINED.lesson.kind.reminder-timing": "अनुस्मारक का समय",
	"RETAINED.lesson.kind.shortlist-order": "शॉर्टलिस्ट का क्रम",
	"RETAINED.lesson.statusName": "स्थिति",
	"RETAINED.lesson.kindName": "मार्गदर्शन का प्रकार",
	"RETAINED.lesson.rationale": "क्यों",
	"RETAINED.lesson.change": "यह क्या बदलेगी",
	"RETAINED.lesson.target": "लक्ष्य",
	"RETAINED.lesson.targetValue": "अभी का कॉन्फ़िगर किया गया मान",
	"RETAINED.lesson.targetPin": "लक्ष्य की पिन",
	"RETAINED.lesson.owner": "मालिक",
	"RETAINED.lesson.evidence": "साक्ष्य",
	"RETAINED.lesson.evidence.kind.job": "काम",
	"RETAINED.lesson.evidence.kind.calculation": "गणना",
	"RETAINED.lesson.evidence.standing": "स्थिति",
	"RETAINED.lesson.evidence.available": "उपलब्ध",
	"RETAINED.lesson.evidence.unavailable": "उपलब्ध नहीं",
	"RETAINED.lesson.evidence.tainted": "स्रोत दूषित चिह्नित",
	"RETAINED.lesson.evidence.clean": "स्रोत दूषित चिह्नित नहीं",
	"RETAINED.lesson.sourceTaint": "स्रोत की शुद्धता",
	"RETAINED.lesson.sources": "स्रोत",
	"RETAINED.lesson.branches": "शाखाएँ",
	"RETAINED.lesson.markings": "स्रोत के चिह्न",
	"RETAINED.lesson.marking": "{source}: {marking}",
	"RETAINED.lesson.scope": "कहाँ लागू होती है",
	"RETAINED.lesson.member": "सदस्य",
	"RETAINED.lesson.conditions": "शर्तें",
	"RETAINED.lesson.counterexamples": "कहाँ लागू नहीं होती",
	"RETAINED.lesson.evaluation": "मूल्यांकन",
	"RETAINED.lesson.evaluation.none": "कोई मूल्यांकन बंधा नहीं है। मंज़ूर करें और अभी नहीं उपलब्ध नहीं हैं।",
	"RETAINED.lesson.evaluation.open": "खुला सेट",
	"RETAINED.lesson.evaluation.hidden": "छिपा सेट",
	"RETAINED.lesson.evaluation.status": "रन की स्थिति",
	"RETAINED.lesson.evaluation.status.complete": "पूरा",
	"RETAINED.lesson.evaluation.status.incomplete": "अपूर्ण",
	"RETAINED.lesson.evaluation.status.declined": "अस्वीकार",
	"RETAINED.lesson.qualification.synthetic-protocol": "कृत्रिम प्रोटोकॉल: केवल जीवनचक्र की जाँच, किसी असली छिपे सूट का नतीजा नहीं।",
	"RETAINED.lesson.qualification.owner-qualified": "मालिक द्वारा योग्य ठहराया गया, जैसा स्थापित मूल्यांकन मालिक ने तय किया।",
	"RETAINED.lesson.authority": "प्राधिकार",
	"RETAINED.lesson.comparison": "तुलना",
	"RETAINED.lesson.completedAt": "पूरा होने का समय",
	"RETAINED.lesson.baselineDigest": "मार्गदर्शन-रहित आधार डाइजेस्ट",
	"RETAINED.lesson.metrics": "मापक, जैसे दिए गए",
	"RETAINED.lesson.metric": "{name}: पहले {before}, बाद में {after} ({direction})",
	"RETAINED.lesson.direction.higher-is-better": "ज़्यादा बेहतर है",
	"RETAINED.lesson.direction.lower-is-better": "कम बेहतर है",
	"RETAINED.lesson.pins": "संदर्भ, सूट, हार्नेस, बिल्ड और कॉन्फ़िगरेशन",
	"RETAINED.lesson.reference": "रन संदर्भ",
	"RETAINED.lesson.suite": "सूट",
	"RETAINED.lesson.harness": "हार्नेस",
	"RETAINED.lesson.build": "बिल्ड",
	"RETAINED.lesson.configuration": "कॉन्फ़िगरेशन",
	"RETAINED.lesson.artifact": "{id}, संस्करण {revision}, डाइजेस्ट {digest}",
	"RETAINED.lesson.evaluationDigest": "मूल्यांकन डाइजेस्ट",
	"RETAINED.lesson.review": "मानवीय समीक्षा",
	"RETAINED.lesson.review.none": "इस सीख के लिए कोई मौजूदा मानवीय समीक्षा टोकन जारी नहीं हुआ। मंज़ूर करें और अभी नहीं उपलब्ध नहीं हैं।",
	"RETAINED.lesson.reviewId": "समीक्षा",
	"RETAINED.lesson.reviewer": "समीक्षक",
	"RETAINED.lesson.reviewedAt": "जारी होने का समय",
	"RETAINED.lesson.digest": "डाइजेस्ट",
	"RETAINED.lesson.identity": "सटीक पहचान",
	"RETAINED.lesson.candidate": "उम्मीदवार",
	"RETAINED.lesson.candidatePin": "{id}, संस्करण {revision}",
	"RETAINED.lesson.workspace": "कार्यक्षेत्र",
	"RETAINED.lesson.proposedBy": "किसने प्रस्तावित किया",
	"RETAINED.lesson.proposedAt": "प्रस्ताव का समय",
	"RETAINED.lesson.episodes": "प्रसंग",
	"RETAINED.lesson.supersedes": "किसकी जगह लेती है",
	"RETAINED.lesson.actor": "{member}, {role}, युग {epoch}",
	"RETAINED.lesson.actorPin": "{member}, {role} ({enum}), युग {epoch}",
	"RETAINED.lesson.reason": "आपका कारण",
	"RETAINED.lesson.reasonRequired": "मंज़ूर करें या अभी नहीं से पहले अपना कारण लिखें।",
	"RETAINED.lesson.reasonInvalid": "आपका कारण अधिकतम 4000 अक्षरों का सादा पाठ होना चाहिए।",
	"RETAINED.lesson.decisionNote": "मंज़ूर करें इस सीख को आपके निजी मार्गदर्शन के रूप में दर्ज करता है। अभी नहीं इसे टाल देता है। दोनों में से कोई भी अर्थ, नुस्खा, गणना या अनुस्मारक नहीं बदलता, और कहीं कुछ नहीं भेजा जाता।",
	"RETAINED.lesson.block.status": "केवल समीक्षा के लिए तैयार सीख पर निर्णय हो सकता है।",
	"RETAINED.lesson.block.evaluation": "निर्णय से पहले दोनों मूल्यांकन पूरे और अदूषित होने चाहिए।",
	"RETAINED.lesson.block.review": "इस मूल्यांकन से कोई मौजूदा मानवीय समीक्षा बंधी नहीं है।",
	"RETAINED.lesson.block.reviewer": "यह समीक्षा किसी और समीक्षक या मालिक की है।",
	"RETAINED.lesson.block.role": "आपकी भूमिका सीख पढ़ सकती है। निर्णय मालिक या सह-संस्थापक लेता है।",
	"RETAINED.lesson.block.workspace": "यह सीख किसी और कार्यक्षेत्र की है।"
}, Nn = {
	en: jn,
	hi: Mn
}, Pn = (0, _.createContext)("en");
function Fn({ language: e, children: t }) {
	return /* @__PURE__ */ (0, A.jsx)(Pn.Provider, {
		value: e,
		children: /* @__PURE__ */ (0, A.jsx)(An, {
			locale: e,
			messages: Nn[e],
			defaultLocale: "en",
			children: t
		})
	});
}
function In() {
	return (0, _.useContext)(Pn);
}
function j() {
	let e = _n();
	return (t, n) => e.formatMessage({ id: t }, n);
}
//#endregion
//#region app/ui/src/app/routes.ts
var Ln = [
	"today",
	"ask",
	"work",
	"books",
	"reports",
	"tools",
	"trust"
], Rn = /* @__PURE__ */ new Set([
	...Ln,
	"company",
	"clients",
	"more"
]);
function zn(e) {
	return Rn.has(e);
}
var Bn = /^[a-z][a-z0-9-]{0,63}$/, Vn = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
function Hn(e) {
	let t = (e.startsWith("#") ? e.slice(1) : e).split("?"), n = t[0], r = t[1], i = (n ?? "").split("/").map((e) => e.trim()).filter((e) => e.length > 0), a = i[0] ?? "today";
	if (!zn(a)) return { place: "today" };
	let o = a, s = i[1], c = s !== void 0 && Bn.test(s) ? s : void 0, l;
	if (n === `/${o}${c === void 0 ? "" : `/${c}`}` && t.length === 2 && r?.startsWith("sheet=")) {
		let e = r.slice(6);
		Vn.exec(e)?.[0] === e && (l = e);
	}
	let u = { place: o };
	return c !== void 0 && (u.sub = c), l !== void 0 && (u.sheet = l), u;
}
function Un(e) {
	let t = `#/${e.place}`;
	return e.sub && (t += `/${e.sub}`), e.sheet && (t += `?sheet=${e.sheet}`), t;
}
function Wn(e, t) {
	return e.place === t.place && e.sub === t.sub && e.sheet === t.sheet;
}
function Gn(e) {
	let t = { place: e.place };
	return e.sub !== void 0 && (t.sub = e.sub), t;
}
function Kn(e, t) {
	return {
		...Gn(e),
		sheet: t
	};
}
//#endregion
//#region app/ui/src/app/places.ts
var M = (e, t) => ({
	id: t,
	nameKey: `SH-01.sub.${e}.${t}`
}), qn = {
	today: [M("today", "today"), M("today", "activity")],
	ask: [
		M("ask", "new"),
		M("ask", "saved"),
		M("ask", "decisions"),
		M("ask", "checks"),
		M("ask", "notyet")
	],
	work: [
		M("work", "approvals"),
		M("work", "jobs"),
		M("work", "actions"),
		M("work", "cando")
	],
	books: [
		M("books", "sources"),
		M("books", "meanings"),
		M("books", "accounts"),
		M("books", "customers"),
		M("books", "history"),
		M("books", "memory")
	],
	reports: [
		M("reports", "packs"),
		M("reports", "weekahead"),
		M("reports", "duedates"),
		M("reports", "exports")
	],
	tools: [
		M("tools", "smallapps"),
		M("tools", "plugins"),
		M("tools", "assistants"),
		M("tools", "phone")
	],
	trust: [
		M("trust", "rules"),
		M("trust", "people"),
		M("trust", "models"),
		M("trust", "network"),
		M("trust", "record"),
		M("trust", "sharing"),
		M("trust", "vault")
	]
}, Jn = {
	today: qn.today,
	ask: [...qn.ask, M("ask", "plans")],
	work: [
		...qn.work,
		M("work", "cases"),
		M("work", "agents")
	],
	books: [
		M("books", "sources"),
		M("books", "meanings"),
		M("books", "accounts"),
		M("books", "records"),
		M("books", "history"),
		M("books", "memory"),
		M("books", "issues"),
		M("books", "companies")
	],
	reports: [
		M("reports", "packs"),
		M("reports", "briefs"),
		M("reports", "duedates"),
		M("reports", "exports"),
		M("reports", "sent")
	],
	tools: [
		M("tools", "smallapps"),
		M("tools", "plugins"),
		M("tools", "assistants"),
		M("tools", "planning")
	],
	trust: [
		...qn.trust,
		M("trust", "access"),
		M("trust", "markings"),
		M("trust", "retention"),
		M("trust", "channels")
	],
	company: [
		M("company", "signin"),
		M("company", "health"),
		M("company", "recovery"),
		M("company", "keys"),
		M("company", "support"),
		M("company", "computers"),
		M("company", "quality"),
		M("company", "build"),
		M("company", "licence")
	]
}, Yn = (e, t) => ({
	id: e,
	nameKey: `SH-01.place.${e}`,
	subs: t
}), Xn = [
	Yn("today", []),
	Yn("clients", []),
	Yn("work", [
		M("work", "cosign"),
		M("work", "many"),
		M("work", "questions")
	]),
	Yn("reports", [M("reports", "handover")]),
	Yn("tools", [M("tools", "library"), M("tools", "invite")]),
	Yn("trust", [M("trust", "people"), M("trust", "firmname")])
];
function Zn(e) {
	return e.kind === "enterprise" ? e.allowed : void 0;
}
function Qn(e, t, n) {
	let r = Zn(e);
	return er(e, t).some((e) => e.id === n) && (r === void 0 || r.has(`${t}.${n}`));
}
function $n(e) {
	if (e === "company") return Jn.company;
	let t = Ln.find((t) => t === e);
	return t === void 0 ? [] : Jn[t];
}
function er(e, t) {
	if (e.kind === "enterprise") return $n(t);
	if (e.kind === "ca-firm") return Xn.find((e) => e.id === t)?.subs ?? [];
	let n = Ln.find((e) => e === t);
	return n === void 0 ? [] : qn[n];
}
function tr(e, t) {
	let n = Zn(e);
	return n === void 0 || $n(t).some((e) => n.has(`${t}.${e.id}`));
}
function nr(e, t) {
	return Zn(e) === void 0 ? t : {
		...t,
		subs: t.subs.filter((n) => Qn(e, t.id, n.id))
	};
}
function rr(e) {
	return e.kind === "ca-firm" ? Xn : e.kind === "enterprise" ? [...Ln, "company"].filter((t) => cr(e, t)).map((t) => nr(e, Yn(t, Jn[t]))) : e.view === "simple" ? [
		Yn("today", qn.today),
		Yn("ask", qn.ask),
		Yn("work", qn.work),
		Yn("more", [])
	] : Ln.map((e) => Yn(e, qn[e]));
}
function ir() {
	return [
		Yn("books", qn.books),
		Yn("reports", qn.reports),
		Yn("tools", qn.tools),
		Yn("trust", qn.trust)
	];
}
function ar(e, t) {
	return e.kind === "desktop" && e.view === "simple" && ir().some((e) => e.id === t) ? "more" : t;
}
function or(e, t) {
	return cr(e, t) && (t === "today" || e.kind === "ca-firm" && t === "clients");
}
function sr(e) {
	return e.kind === "ca-firm" ? [
		"today",
		"clients",
		"work",
		"reports",
		"tools",
		"trust"
	] : Ln;
}
function cr(e, t) {
	return t === "more" ? e.kind === "desktop" && e.view === "simple" : t === "company" ? e.kind === "enterprise" && e.administers === !0 && tr(e, t) : t === "clients" ? e.kind === "ca-firm" : e.kind === "ca-firm" ? t !== "ask" && t !== "books" : tr(e, t);
}
function lr(e, t) {
	if (t !== void 0 && Zn(e) === void 0) return cr(e, t) ? { place: t } : null;
	let n = rr(e), r = t === void 0 ? n[0] : n.find((e) => e.id === t);
	if (r === void 0) return null;
	let i = r.subs[0];
	return Zn(e) === void 0 ? { place: r.id } : i === void 0 ? null : {
		place: r.id,
		sub: i.id
	};
}
function ur(e, t) {
	return cr(e, t.place) ? t.sub !== void 0 && !Qn(e, t.place, t.sub) || t.sub === void 0 && Zn(e) !== void 0 ? lr(e, t.place) : t : lr(e);
}
//#endregion
//#region app/ui/src/app/composition.ts
function dr(e, t) {
	if (e !== null && e.sheet !== void 0 && t !== void 0) return Wn(e, t.address) ? t.content : void 0;
}
function fr(e) {
	return e.kind === "locked" || e.kind === "boundary-state" && e.source.kind === "locked";
}
function pr(e, t) {
	t !== null && (e.preventDefault(), !t.money && !t.disabled && t.onPress());
}
//#endregion
//#region app/ui/src/app/keys.ts
function mr(e) {
	let t = e.code === "Space" || e.key === " ";
	if (e.type === "keyup") return t || e.key === "Control" || e.key === "Meta" ? {
		kind: "talk",
		phase: "end"
	} : null;
	if (e.type !== "keydown" || e.isComposing || e.keyCode === 229 || e.defaultPrevented) return null;
	let n = e.ctrlKey || e.metaKey, r = n && !e.altKey && !e.shiftKey, i = e.altKey && !n && !e.shiftKey, a = !n && !e.altKey && !e.shiftKey;
	return r && (e.key === "k" || e.key === "K") ? { kind: "ask" } : r && e.key.length === 1 && e.key >= "1" && e.key <= "7" ? {
		kind: "place",
		index: Number(e.key) - 1
	} : r && e.key === "/" ? { kind: "help" } : r && e.key === "Enter" ? { kind: "primary" } : r && t ? e.repeat ? null : {
		kind: "talk",
		phase: "start"
	} : e.key === "F6" && !n && !e.altKey ? {
		kind: "region",
		backwards: e.shiftKey
	} : e.key === "Escape" && a ? { kind: "escape" } : i && e.key === "ArrowDown" ? {
		kind: "adjacent",
		delta: 1
	} : i && e.key === "ArrowUp" ? {
		kind: "adjacent",
		delta: -1
	} : null;
}
var hr = [
	"rail",
	"page",
	"sheet",
	"ask"
];
function gr(e, t, n) {
	let r = hr.filter((e) => t.has(e));
	if (r.length === 0) return null;
	let i = e ? r.indexOf(e) : -1;
	return i === -1 ? (n ? r[r.length - 1] : r[0]) ?? null : r[(i + (n ? -1 : 1) + r.length) % r.length] ?? null;
}
var _r = {
	rail: "_rail_1nm2z_1",
	top: "_top_1nm2z_11",
	wordmark: "_wordmark_1nm2z_15",
	mark: "_mark_1nm2z_21",
	m1: "_m1_1nm2z_25",
	m2: "_m2_1nm2z_26",
	word: "_word_1nm2z_15",
	places: "_places_1nm2z_35",
	subs: "_subs_1nm2z_36",
	placeItem: "_placeItem_1nm2z_42",
	place: "_place_1nm2z_35",
	sub: "_sub_1nm2z_36",
	here: "_here_1nm2z_61",
	count: "_count_1nm2z_65",
	foot: "_foot_1nm2z_78",
	topbar: "_topbar_1nm2z_83",
	menu: "_menu_1nm2z_93",
	summary: "_summary_1nm2z_97",
	menuBody: "_menuBody_1nm2z_109"
};
//#endregion
//#region app/ui/src/app/Rail.tsx
function vr() {
	let e = j();
	return /* @__PURE__ */ (0, A.jsxs)("span", {
		className: _r.wordmark,
		children: [/* @__PURE__ */ (0, A.jsxs)("svg", {
			className: _r.mark,
			viewBox: "0 0 20 20",
			"aria-hidden": "true",
			focusable: "false",
			children: [/* @__PURE__ */ (0, A.jsx)("rect", {
				x: "1",
				y: "1",
				width: "9",
				height: "9",
				rx: "1.5",
				className: _r.m1
			}), /* @__PURE__ */ (0, A.jsx)("rect", {
				x: "10",
				y: "10",
				width: "9",
				height: "9",
				rx: "1.5",
				className: _r.m2
			})]
		}), /* @__PURE__ */ (0, A.jsx)("span", {
			className: _r.word,
			children: e("SH-01.wordmark")
		})]
	});
}
function yr({ shell: e, address: t, onNavigate: n, counts: r, foot: i, narrow: a }) {
	let o = j(), s = rr(e), c = (0, _.useId)(), l = ar(e, t.place), u = (e, t) => {
		let r = { place: e };
		t !== void 0 && (r.sub = t), n(r);
	}, d = (t) => or(e, t) ? r?.[t] : void 0, f = /* @__PURE__ */ (0, A.jsx)("ul", {
		className: _r.places,
		children: s.map((e) => {
			let n = e.id === l, r = d(e.id), i = e.id === "more" ? ir() : [];
			return /* @__PURE__ */ (0, A.jsxs)("li", {
				className: _r.placeItem,
				children: [
					/* @__PURE__ */ (0, A.jsxs)("a", {
						href: Un({ place: e.id }),
						className: [_r.place, n ? _r.here : ""].join(" "),
						"aria-current": n ? e.id === t.place ? "page" : "true" : void 0,
						onClick: (t) => {
							t.preventDefault(), u(e.id);
						},
						children: [/* @__PURE__ */ (0, A.jsx)("span", { children: o(e.nameKey) }), r && /* @__PURE__ */ (0, A.jsx)("span", {
							className: [_r.count, "fig"].join(" "),
							"aria-label": o("SH-01.count", { count: r.display }),
							children: r.display
						})]
					}),
					n && i.length > 0 && /* @__PURE__ */ (0, A.jsx)("ul", {
						className: _r.subs,
						children: i.map((e) => {
							let n = t.place === e.id;
							return /* @__PURE__ */ (0, A.jsx)("li", { children: /* @__PURE__ */ (0, A.jsx)("a", {
								href: Un({ place: e.id }),
								className: [_r.sub, n ? _r.here : ""].join(" "),
								"aria-current": n ? "page" : void 0,
								onClick: (t) => {
									t.preventDefault(), u(e.id);
								},
								children: o(e.nameKey)
							}) }, e.id);
						})
					}),
					n && e.subs.length > 0 && /* @__PURE__ */ (0, A.jsx)("ul", {
						className: _r.subs,
						children: e.subs.map((n) => {
							let r = t.sub === n.id || t.sub === void 0 && n === e.subs[0];
							return /* @__PURE__ */ (0, A.jsx)("li", { children: /* @__PURE__ */ (0, A.jsx)("a", {
								href: Un({
									place: e.id,
									sub: n.id
								}),
								className: [_r.sub, r ? _r.here : ""].join(" "),
								"aria-current": r ? "page" : void 0,
								onClick: (t) => {
									t.preventDefault(), u(e.id, n.id);
								},
								children: o(n.nameKey)
							}) }, n.id);
						})
					})
				]
			}, e.id);
		})
	});
	if (a) {
		let e = d("today");
		return /* @__PURE__ */ (0, A.jsxs)("nav", {
			className: _r.topbar,
			"aria-label": o("SH-01.rail.label"),
			"data-region": "rail",
			children: [/* @__PURE__ */ (0, A.jsx)(vr, {}), /* @__PURE__ */ (0, A.jsxs)("details", {
				className: _r.menu,
				children: [/* @__PURE__ */ (0, A.jsxs)("summary", {
					className: _r.summary,
					"aria-controls": c,
					"data-region-entry": "",
					children: [/* @__PURE__ */ (0, A.jsx)("span", { children: o(`SH-01.place.${t.place}`) }), e && /* @__PURE__ */ (0, A.jsx)("span", {
						className: [_r.count, "fig"].join(" "),
						"aria-label": o("SH-01.count", { count: e.display }),
						children: e.display
					})]
				}), /* @__PURE__ */ (0, A.jsxs)("div", {
					id: c,
					className: _r.menuBody,
					children: [f, /* @__PURE__ */ (0, A.jsx)("div", {
						className: _r.foot,
						children: i
					})]
				})]
			})]
		});
	}
	return /* @__PURE__ */ (0, A.jsxs)("nav", {
		className: _r.rail,
		"aria-label": o("SH-01.rail.label"),
		"data-region": "rail",
		children: [
			/* @__PURE__ */ (0, A.jsx)("div", {
				className: _r.top,
				children: /* @__PURE__ */ (0, A.jsx)(vr, {})
			}),
			f,
			/* @__PURE__ */ (0, A.jsx)("div", {
				className: _r.foot,
				children: i
			})
		]
	});
}
var br = {
	square: "_square_1buaq_1",
	cha: "_cha_1buaq_12",
	you: "_you_1buaq_14",
	wait: "_wait_1buaq_16",
	busy: "_busy_1buaq_18",
	unsure: "_unsure_1buaq_20",
	guess: "_guess_1buaq_22",
	off: "_off_1buaq_24",
	words: "_words_1buaq_26"
}, xr = {
	cha: "MARK.cha",
	you: "MARK.you",
	wait: "MARK.wait",
	busy: "MARK.busy",
	unsure: "MARK.unsure",
	guess: "MARK.guess",
	off: "MARK.off"
};
function Sr({ mark: e, wordsKey: t, showWords: n = !1, className: r }) {
	let i = j()(t ?? xr[e]);
	return /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)("span", {
		className: [
			br.square,
			br[e],
			r
		].filter(Boolean).join(" "),
		"aria-hidden": "true"
	}), /* @__PURE__ */ (0, A.jsx)("span", {
		className: n ? br.words : "sr",
		children: i
	})] });
}
var Cr = {
	button: "_button_4s53g_1",
	filled: "_filled_4s53g_19",
	quiet: "_quiet_4s53g_30",
	link: "_link_4s53g_35",
	danger: "_danger_4s53g_47"
};
//#endregion
//#region app/ui/src/parts/Button.tsx
function wr({ variant: e = "quiet", danger: t = !1, submit: n = !1, className: r, children: i, ...a }) {
	let o = [
		Cr.button,
		Cr[e],
		t ? Cr.danger : "",
		"m-press",
		r
	].filter(Boolean).join(" ");
	return /* @__PURE__ */ (0, A.jsx)("button", {
		type: n ? "submit" : "button",
		className: o,
		...a,
		children: i
	});
}
//#endregion
//#region app/ui/src/app/ask-question.ts
function Tr(e) {
	return e.trim().length === 0 ? null : e;
}
var Er = {
	line: "_line_11wcx_1",
	about: "_about_11wcx_12",
	aboutClear: "_aboutClear_11wcx_20",
	input: "_input_11wcx_24",
	mic: "_mic_11wcx_40",
	glyph: "_glyph_11wcx_59",
	hold: "_hold_11wcx_64",
	key: "_key_11wcx_70",
	state: "_state_11wcx_77",
	suggestions: "_suggestions_11wcx_86",
	suggestion: "_suggestion_11wcx_86",
	kind: "_kind_11wcx_115"
};
//#endregion
//#region app/ui/src/app/AskLine.tsx
function Dr(e) {
	let t = (0, _.useRef)(null), n = (0, _.useRef)(e);
	(0, _.useEffect)(() => {
		n.current = e;
	});
	let r = (0, _.useMemo)(() => ({
		start: () => {
			let e = n.current;
			e && e.on && !t.current && (t.current = e.onHoldEnd, e.onHoldStart());
		},
		end: () => {
			let e = t.current;
			e && (t.current = null, e());
		},
		isHeld: () => t.current !== null
	}), []), i = e?.on === !0;
	return (0, _.useEffect)(() => {
		if (!i) {
			r.end();
			return;
		}
		let e = () => {
			document.visibilityState === "hidden" && r.end();
		};
		return window.addEventListener("blur", r.end), document.addEventListener("visibilitychange", e), () => {
			window.removeEventListener("blur", r.end), document.removeEventListener("visibilitychange", e), r.end();
		};
	}, [i, r]), r;
}
var Or = (0, _.forwardRef)(function({ onAsk: e, onChange: t, suggestions: n, onPick: r, about: i, voice: a, hold: o, simple: s = !1, noModel: c = !1, readOnly: l, placeholderKey: u = "SH-04.placeholder" }, d) {
	let f = j(), [p, m] = (0, _.useState)(""), h = (0, _.useId)(), g = (t) => {
		t.preventDefault();
		let n = Tr(p);
		n !== null && (e(n), m(""));
	}, v = a ? a.on ? {
		onPointerDown: (e) => {
			e.button === 0 && (e.currentTarget.setPointerCapture(e.pointerId), o.start());
		},
		onPointerUp: o.end,
		onPointerCancel: o.end,
		onLostPointerCapture: o.end,
		onBlur: o.end
	} : { onClick: a.onOpenSettings } : {}, y = a ? s ? /* @__PURE__ */ (0, A.jsxs)(wr, {
		variant: "quiet",
		className: Er.hold,
		"aria-pressed": a.listening ? !0 : void 0,
		...v,
		children: [
			/* @__PURE__ */ (0, A.jsx)(kr, {}),
			" ",
			a.on ? f("SH-04.mic") : f("SH-04.mic.off.short")
		]
	}) : /* @__PURE__ */ (0, A.jsx)("button", {
		type: "button",
		className: Er.mic,
		"aria-label": a.on ? f("SH-04.mic") : f("SH-04.mic.off"),
		"aria-pressed": a.listening ? !0 : void 0,
		title: a.costPerMinute === void 0 ? void 0 : f("SH-04.mic.cost", { cost: a.costPerMinute }),
		...v,
		children: /* @__PURE__ */ (0, A.jsx)(kr, {})
	}) : null;
	return /* @__PURE__ */ (0, A.jsxs)("form", {
		className: Er.line,
		role: "search",
		"aria-label": f("SH-01.region.ask"),
		onSubmit: g,
		"data-region": "ask",
		children: [
			/* @__PURE__ */ (0, A.jsx)(Sr, {
				mark: "you",
				wordsKey: "MARK.you"
			}),
			i && /* @__PURE__ */ (0, A.jsxs)("span", {
				className: Er.about,
				children: [/* @__PURE__ */ (0, A.jsx)("span", { children: f("SH-04.about", { name: i.name }) }), /* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "link",
					onClick: i.onClear,
					className: Er.aboutClear,
					children: f("SH-04.about.clear")
				})]
			}),
			/* @__PURE__ */ (0, A.jsx)("input", {
				ref: d,
				className: Er.input,
				type: "text",
				value: p,
				placeholder: f(u),
				"aria-label": f(u),
				"aria-autocomplete": n ? "list" : void 0,
				"aria-controls": n ? h : void 0,
				onChange: (e) => {
					m(e.target.value), t?.(e.target.value);
				}
			}),
			y,
			!s && /* @__PURE__ */ (0, A.jsx)("span", {
				className: [Er.key, "fig"].join(" "),
				"aria-hidden": "true",
				children: f("SH-04.key")
			}),
			a?.listening && /* @__PURE__ */ (0, A.jsx)("span", {
				className: Er.state,
				role: "status",
				children: f("SH-04.listening")
			}),
			c && /* @__PURE__ */ (0, A.jsx)("span", {
				className: Er.state,
				role: "status",
				children: f("SH-04.noModel")
			}),
			l && /* @__PURE__ */ (0, A.jsx)("span", {
				className: Er.state,
				children: f("SH-04.readOnly", { holder: l.holder })
			}),
			n && n.length > 0 && /* @__PURE__ */ (0, A.jsx)("ul", {
				id: h,
				className: Er.suggestions,
				role: "listbox",
				children: n.slice(0, 5).map((e) => /* @__PURE__ */ (0, A.jsx)("li", {
					role: "option",
					"aria-selected": !1,
					children: r ? /* @__PURE__ */ (0, A.jsxs)("button", {
						type: "button",
						className: Er.suggestion,
						onClick: () => r(e.id),
						children: [/* @__PURE__ */ (0, A.jsx)("span", { children: e.text }), /* @__PURE__ */ (0, A.jsx)("span", {
							className: Er.kind,
							children: f(`SH-04.kind.${e.kind}`)
						})]
					}) : /* @__PURE__ */ (0, A.jsxs)("span", {
						className: Er.suggestion,
						children: [/* @__PURE__ */ (0, A.jsx)("span", { children: e.text }), /* @__PURE__ */ (0, A.jsx)("span", {
							className: Er.kind,
							children: f(`SH-04.kind.${e.kind}`)
						})]
					})
				}, e.id))
			})
		]
	});
});
function kr() {
	return /* @__PURE__ */ (0, A.jsxs)("svg", {
		className: Er.glyph,
		viewBox: "0 0 16 16",
		"aria-hidden": "true",
		focusable: "false",
		children: [/* @__PURE__ */ (0, A.jsx)("rect", {
			x: "5.5",
			y: "1.5",
			width: "5",
			height: "8",
			rx: "2.5",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "1.2"
		}), /* @__PURE__ */ (0, A.jsx)("path", {
			d: "M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "1.2",
			strokeLinecap: "round"
		})]
	});
}
var Ar = {
	line: "_line_1fry5_1",
	fact: "_fact_1fry5_12",
	simple: "_simple_1fry5_22"
};
//#endregion
//#region app/ui/src/app/StatusLine.tsx
function jr({ status: e, view: t, onNavigate: n, simpleSentences: r }) {
	let i = j();
	if (t === "simple" && r) return /* @__PURE__ */ (0, A.jsxs)("p", {
		className: [Ar.line, Ar.simple].join(" "),
		role: "status",
		"aria-label": i("SH-01.region.status"),
		"data-region": "status",
		children: [/* @__PURE__ */ (0, A.jsx)("span", { children: r[0] }), /* @__PURE__ */ (0, A.jsx)("span", { children: r[1] })]
	});
	let a = [
		e.sources,
		e.model,
		e.third
	];
	return /* @__PURE__ */ (0, A.jsxs)("p", {
		className: [Ar.line, "fig"].join(" "),
		role: "status",
		"aria-label": i("SH-01.region.status"),
		"data-region": "status",
		children: [a.map((e, t) => e.address ? /* @__PURE__ */ (0, A.jsx)("a", {
			className: Ar.fact,
			href: Un(e.address),
			onClick: (t) => {
				t.preventDefault(), e.address && n(e.address);
			},
			children: e.text
		}, t) : /* @__PURE__ */ (0, A.jsx)("span", {
			className: Ar.fact,
			children: e.text
		}, t)), t === "books" && /* @__PURE__ */ (0, A.jsx)("span", {
			className: Ar.fact,
			children: i("SH-01.status.keys")
		})]
	});
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/chain.mjs
function Mr(...e) {
	return (...t) => {
		for (let n of e) typeof n == "function" && n(...t);
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useLayoutEffect.mjs
var Nr = typeof document < "u" ? _.useLayoutEffect : () => {}, Pr = {
	prefix: String(Math.round(Math.random() * 1e10)),
	current: 0
}, Fr = /*#__PURE__*/ _.createContext(Pr), Ir = /*#__PURE__*/ _.createContext(!1);
typeof window < "u" && window.document && window.document.createElement;
var Lr = /* @__PURE__ */ new WeakMap();
function Rr(e = !1) {
	let t = (0, _.useContext)(Fr), n = (0, _.useRef)(null);
	if (n.current === null && !e) {
		let e = _.default.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentOwner?.current;
		if (e) {
			let n = Lr.get(e);
			n == null ? Lr.set(e, {
				id: t.current,
				state: e.memoizedState
			}) : e.memoizedState !== n.state && (t.current = n.id, Lr.delete(e));
		}
		n.current = ++t.current;
	}
	return n.current;
}
function zr(e) {
	let t = (0, _.useContext)(Fr), n = Rr(!!e), r = `react-aria${t.prefix}`;
	return e || `${r}-${n}`;
}
function Br(e) {
	let t = _.useId(), [n] = (0, _.useState)(Gr()), r = n ? "react-aria" : `react-aria${Pr.prefix}`;
	return e || `${r}-${t}`;
}
var Vr = typeof _.useId == "function" ? Br : zr;
function Hr() {
	return !1;
}
function Ur() {
	return !0;
}
function Wr(e) {
	return () => {};
}
function Gr() {
	return typeof _.useSyncExternalStore == "function" ? _.useSyncExternalStore(Wr, Hr, Ur) : (0, _.useContext)(Ir);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useValueEffect.mjs
function Kr(e) {
	let [t, n] = (0, _.useState)(e), r = (0, _.useRef)(t), i = (0, _.useRef)(null), a = (0, _.useRef)(() => {
		if (!i.current) return;
		let e = i.current.next();
		if (e.done) {
			i.current = null;
			return;
		}
		r.current === e.value ? a.current() : n(e.value);
	});
	return Nr(() => {
		r.current = t, i.current && a.current();
	}), [t, (0, _.useCallback)((e) => {
		i.current = e(r.current), a.current();
	}, [a])];
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useId.mjs
var qr = !!(typeof window < "u" && window.document && window.document.createElement), Jr = /* @__PURE__ */ new Map(), Yr;
typeof FinalizationRegistry < "u" && (Yr = new FinalizationRegistry((e) => {
	Jr.delete(e);
}));
var Xr = /* @__PURE__ */ new WeakMap();
function Zr(e) {
	let [t, n] = (0, _.useState)(e), r = (0, _.useRef)(null), i = Vr(t), a = (0, _.useRef)(null), o = Xr.get(a);
	if (Yr && o !== i && (o != null && Yr.unregister(a), Yr.register(a, i, a), Xr.set(a, i)), qr) {
		let e = Jr.get(i);
		e && !e.includes(r) ? e.push(r) : Jr.set(i, [r]);
	}
	return Nr(() => {
		let e = i;
		return () => {
			Yr && (Yr.unregister(a), Xr.delete(a)), Jr.delete(e);
		};
	}, [i]), (0, _.useEffect)(() => {
		let e = r.current;
		return e && n(e), () => {
			e && (r.current = null);
		};
	}), i;
}
function Qr(e, t) {
	if (e === t) return e;
	let n = Jr.get(e);
	if (n) return n.forEach((e) => e.current = t), t;
	let r = Jr.get(t);
	return r ? (r.forEach((t) => t.current = e), e) : t;
}
function $r(e = []) {
	let t = Zr(), [n, r] = Kr(t), i = (0, _.useCallback)(() => {
		r(function* () {
			yield t, yield document.getElementById(t) ? t : void 0;
		});
	}, [t, r]);
	return Nr(i, [
		t,
		i,
		...e
	]), n;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/mergeRefs.mjs
function ei(...e) {
	return e.length === 1 && e[0] ? e[0] : (t) => {
		let n = !1, r = e.map((e) => {
			let r = ti(e, t);
			return n ||= typeof r == "function", r;
		});
		if (n) return () => {
			r.forEach((t, n) => {
				typeof t == "function" ? t() : ti(e[n], null);
			});
		};
	};
}
function ti(e, t) {
	if (typeof e == "function") return e(t);
	e != null && (e.current = t);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/clsx/dist/clsx.mjs
function ni(e) {
	var t, n, r = "";
	if (typeof e == "string" || typeof e == "number") r += e;
	else if (typeof e == "object") {
		if (Array.isArray(e)) {
			var i = e.length;
			for (t = 0; t < i; t++) e[t] && (n = ni(e[t])) && (r && (r += " "), r += n);
		} else for (n in e) e[n] && (r && (r += " "), r += n);
	}
	return r;
}
function ri() {
	for (var e, t, n = 0, r = "", i = arguments.length; n < i; n++) (e = arguments[n]) && (t = ni(e)) && (r && (r += " "), r += t);
	return r;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/mergeProps.mjs
function ii(...e) {
	let t = { ...e[0] };
	for (let n = 1; n < e.length; n++) {
		let r = e[n];
		for (let e in r) {
			let n = t[e], i = r[e];
			typeof n == "function" && typeof i == "function" && e[0] === "o" && e[1] === "n" && e.charCodeAt(2) >= 65 && e.charCodeAt(2) <= 90 ? t[e] = Mr(n, i) : (e === "className" || e === "UNSAFE_className") && typeof n == "string" && typeof i == "string" ? t[e] = ri(n, i) : e === "id" && n && i ? t.id = Qr(n, i) : e === "ref" && n && i ? t.ref = ei(n, i) : t[e] = i === void 0 ? n : i;
		}
	}
	return t;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useObjectRef.mjs
function ai(e) {
	let t = (0, _.useRef)(null), n = (0, _.useRef)(void 0), r = (0, _.useCallback)((t) => {
		if (typeof e == "function") {
			let n = e, r = n(t);
			return () => {
				typeof r == "function" ? r() : n(null);
			};
		}
		if (e) return e.current = t, () => {
			e.current = null;
		};
	}, [e]);
	return (0, _.useMemo)(() => ({
		get current() {
			return t.current;
		},
		set current(e) {
			t.current = e, n.current &&= (n.current(), void 0), e != null && (n.current = r(e));
		}
	}), [r]);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria-components/dist/private/utils.mjs
var oi = Symbol("default");
function si({ values: e, children: t }) {
	for (let [n, r] of e) t = /*#__PURE__*/ _.createElement(n.Provider, { value: r }, t);
	return t;
}
function ci(e) {
	let { className: t, style: n, children: r, defaultClassName: i, defaultChildren: a, defaultStyle: o, values: s, render: c } = e;
	return (0, _.useMemo)(() => {
		let e, l, u;
		return e = typeof t == "function" ? t({
			...s,
			defaultClassName: i
		}) : t, l = typeof n == "function" ? n({
			...s,
			defaultStyle: o || {}
		}) : n, u = typeof r == "function" ? r({
			...s,
			defaultChildren: a
		}) : r ?? a, {
			className: e ?? i,
			style: l || o ? {
				...o,
				...l
			} : void 0,
			children: u ?? a,
			"data-rac": "",
			render: c ? (e) => c(e, s) : void 0
		};
	}, [
		t,
		n,
		r,
		i,
		a,
		o,
		s,
		c
	]);
}
function li(e, t) {
	let n = (0, _.useContext)(e);
	if (t === null) return null;
	if (n && typeof n == "object" && "slots" in n && n.slots) {
		let e = t || oi;
		if (!n.slots[e]) {
			let e = new Intl.ListFormat().format(Object.keys(n.slots).map((e) => `"${e}"`)), r = t ? `Invalid slot "${t}".` : "A slot prop is required.";
			throw Error(`${r} Valid slot names are ${e}.`);
		}
		return n.slots[e];
	}
	return n;
}
function ui(e, t, n) {
	let { ref: r, ...i } = li(n, e.slot) || {}, a = ai((0, _.useMemo)(() => ei(t, r), [t, r])), o = ii(i, e);
	return "style" in i && i.style && "style" in e && e.style && (o.style = typeof i.style == "function" || typeof e.style == "function" ? (t) => {
		let n = typeof i.style == "function" ? i.style(t) : i.style, r = {
			...t.defaultStyle,
			...n
		}, a = typeof e.style == "function" ? e.style({
			...t,
			defaultStyle: r
		}) : e.style;
		return {
			...r,
			...a
		};
	} : {
		...i.style,
		...e.style
	}), [o, a];
}
function di(e = !0) {
	let [t, n] = (0, _.useState)(e), r = (0, _.useRef)(!1), i = (0, _.useCallback)((e) => {
		r.current = !0, n(!!e);
	}, []);
	return Nr(() => {
		r.current || n(!1);
	}, []), [i, t];
}
function fi(e, t, n) {
	let { render: r, ...i } = t, a = (0, _.useRef)(null), o = (0, _.useMemo)(() => ei(n, a), [n, a]);
	Nr(() => {}, [e, r]);
	let s = {
		...i,
		ref: o
	};
	return r ? r(s, void 0) : /*#__PURE__*/ _.createElement(e, s);
}
var pi = {}, mi = new Proxy({}, { get(e, t) {
	if (typeof t != "string") return;
	let n = pi[t];
	return n || (n = /*#__PURE__*/ (0, _.forwardRef)(fi.bind(null, t)), pi[t] = n), n;
} });
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/collections/Hidden.mjs
typeof HTMLTemplateElement < "u" && (Object.defineProperty(HTMLTemplateElement.prototype, "firstChild", {
	configurable: !0,
	enumerable: !0,
	get: function() {
		return this.content.firstChild;
	}
}), Object.defineProperty(HTMLTemplateElement.prototype, "appendChild", {
	configurable: !0,
	enumerable: !0,
	value: function(e) {
		return this.content.appendChild(e);
	}
}), Object.defineProperty(HTMLTemplateElement.prototype, "removeChild", {
	configurable: !0,
	enumerable: !0,
	value: function(e) {
		return this.content.removeChild(e);
	}
}), Object.defineProperty(HTMLTemplateElement.prototype, "insertBefore", {
	configurable: !0,
	enumerable: !0,
	value: function(e, t) {
		return this.content.insertBefore(e, t);
	}
}));
var hi = /*#__PURE__*/ (0, _.createContext)(!1);
function gi(e) {
	if ((0, _.useContext)(hi)) return /*#__PURE__*/ _.createElement(_.Fragment, null, e.children);
	let t = /*#__PURE__*/ _.createElement(hi.Provider, { value: !0 }, e.children);
	return /*#__PURE__*/ _.createElement("template", null, t);
}
function _i(e) {
	let t = (t, n) => (0, _.useContext)(hi) ? null : e(t, n);
	return t.displayName = e.displayName || e.name, (0, _.forwardRef)(t);
}
function vi() {
	return (0, _.useContext)(hi);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/filterDOMProps.mjs
var yi = /* @__PURE__ */ new Set(["id"]), bi = /* @__PURE__ */ new Set([
	"aria-label",
	"aria-labelledby",
	"aria-describedby",
	"aria-details"
]), xi = /* @__PURE__ */ new Set([
	"href",
	"hrefLang",
	"target",
	"rel",
	"download",
	"ping",
	"referrerPolicy"
]), Si = /* @__PURE__ */ new Set([
	"dir",
	"lang",
	"hidden",
	"inert",
	"translate"
]), Ci = /* @__PURE__ */ new Set(/* @__PURE__ */ "onClick.onAuxClick.onContextMenu.onDoubleClick.onMouseDown.onMouseEnter.onMouseLeave.onMouseMove.onMouseOut.onMouseOver.onMouseUp.onTouchCancel.onTouchEnd.onTouchMove.onTouchStart.onPointerDown.onPointerMove.onPointerUp.onPointerCancel.onPointerEnter.onPointerLeave.onPointerOver.onPointerOut.onGotPointerCapture.onLostPointerCapture.onScroll.onWheel.onAnimationStart.onAnimationEnd.onAnimationIteration.onTransitionCancel.onTransitionEnd.onTransitionRun.onTransitionStart".split(".")), wi = /^(data-.*)$/;
function Ti(e, t = {}) {
	let { labelable: n, isLink: r, global: i, events: a = i, propNames: o } = t, s = {};
	for (let t in e) Object.prototype.hasOwnProperty.call(e, t) && (yi.has(t) || n && bi.has(t) || r && xi.has(t) || i && Si.has(t) || a && (Ci.has(t) || t.endsWith("Capture") && Ci.has(t.slice(0, -7))) || o?.has(t) || wi.test(t)) && (s[t] = e[t]);
	return s;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useLabels.mjs
function Ei(e, t) {
	let { id: n, "aria-label": r, "aria-labelledby": i } = e;
	return n = Zr(n), i && r ? i = [.../* @__PURE__ */ new Set([n, ...i.trim().split(/\s+/)])].join(" ") : i &&= i.trim().split(/\s+/).join(" "), !r && !i && t && (r = t), {
		id: n,
		"aria-label": r,
		"aria-labelledby": i
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/i18n/utils.mjs
var Di = /* @__PURE__ */ new Set([
	"Arab",
	"Syrc",
	"Samr",
	"Mand",
	"Thaa",
	"Mend",
	"Nkoo",
	"Adlm",
	"Rohg",
	"Hebr"
]), Oi = /* @__PURE__ */ new Set([
	"ae",
	"ar",
	"arc",
	"bcc",
	"bqi",
	"ckb",
	"dv",
	"fa",
	"glk",
	"he",
	"ku",
	"mzn",
	"nqo",
	"pnb",
	"ps",
	"sd",
	"ug",
	"ur",
	"yi"
]);
function ki(e) {
	if (Intl.Locale) {
		let t = new Intl.Locale(e).maximize(), n = typeof t.getTextInfo == "function" ? t.getTextInfo() : t.textInfo;
		if (n) return n.direction === "rtl";
		if (t.script) return Di.has(t.script);
	}
	let t = e.split("-")[0];
	return Oi.has(t);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/i18n/useDefaultLocale.mjs
var Ai = Symbol.for("react-aria.i18n.locale");
function ji() {
	let e = typeof window < "u" && window[Ai] || typeof navigator < "u" && (navigator.language || navigator.userLanguage) || "en-US";
	try {
		Intl.DateTimeFormat.supportedLocalesOf([e]);
	} catch {
		e = "en-US";
	}
	return {
		locale: e,
		direction: ki(e) ? "rtl" : "ltr"
	};
}
var Mi = ji(), Ni = /* @__PURE__ */ new Set();
function Pi() {
	Mi = ji();
	for (let e of Ni) e(Mi);
}
function Fi() {
	let e = Gr(), [t, n] = (0, _.useState)(Mi);
	return (0, _.useEffect)(() => (Ni.size === 0 && window.addEventListener("languagechange", Pi), Ni.add(n), () => {
		Ni.delete(n), Ni.size === 0 && window.removeEventListener("languagechange", Pi);
	}), []), e ? {
		locale: typeof window < "u" && window[Ai] || "en-US",
		direction: "ltr"
	} : t;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/i18n/I18nProvider.mjs
var Ii = /*#__PURE__*/ _.createContext(null);
function Li() {
	let e = Fi();
	return (0, _.useContext)(Ii) || e;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/utils/number.mjs
function Ri(e, t = -Infinity, n = Infinity) {
	return Math.min(Math.max(e, t), n);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria-components/dist/private/ProgressBar.mjs
var zi = /*#__PURE__*/ (0, _.createContext)(null), Bi = 7e3, Vi = null;
function Hi(e, t = "assertive", n = Bi) {
	Vi ? Vi.announce(e, t, n) : (Vi = new Ui(), (typeof IS_REACT_ACT_ENVIRONMENT == "boolean" ? IS_REACT_ACT_ENVIRONMENT : typeof jest < "u") ? Vi.announce(e, t, n) : setTimeout(() => {
		Vi?.isAttached() && Vi?.announce(e, t, n);
	}, 100));
}
var Ui = class {
	constructor() {
		this.node = null, this.assertiveLog = null, this.politeLog = null, typeof document < "u" && (this.node = document.createElement("div"), this.node.dataset.liveAnnouncer = "true", Object.assign(this.node.style, {
			border: 0,
			clip: "rect(0 0 0 0)",
			clipPath: "inset(50%)",
			height: "1px",
			margin: "-1px",
			overflow: "hidden",
			padding: 0,
			position: "absolute",
			width: "1px",
			whiteSpace: "nowrap"
		}), this.assertiveLog = this.createLog("assertive"), this.node.appendChild(this.assertiveLog), this.politeLog = this.createLog("polite"), this.node.appendChild(this.politeLog), document.body.prepend(this.node));
	}
	isAttached() {
		return this.node?.isConnected;
	}
	createLog(e) {
		let t = document.createElement("div");
		return t.setAttribute("role", "log"), t.setAttribute("aria-live", e), t.setAttribute("aria-relevant", "additions"), t;
	}
	destroy() {
		this.node &&= (document.body.removeChild(this.node), null);
	}
	announce(e, t = "assertive", n = Bi) {
		if (!this.node) return;
		let r = document.createElement("div");
		typeof e == "object" ? (r.setAttribute("role", "img"), r.setAttribute("aria-labelledby", e["aria-labelledby"])) : r.textContent = e, t === "assertive" ? this.assertiveLog?.appendChild(r) : this.politeLog?.appendChild(r), e !== "" && setTimeout(() => {
			r.remove();
		}, n);
	}
	clear(e) {
		this.node && ((!e || e === "assertive") && this.assertiveLog && (this.assertiveLog.innerHTML = ""), (!e || e === "polite") && this.politeLog && (this.politeLog.innerHTML = ""));
	}
};
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/focusWithoutScrolling.mjs
function Wi(e) {
	if (Ki()) e.focus({ preventScroll: !0 });
	else {
		let t = qi(e);
		e.focus(), Ji(t);
	}
}
var Gi = null;
function Ki() {
	if (Gi == null) {
		Gi = !1;
		try {
			document.createElement("div").focus({ get preventScroll() {
				return Gi = !0, !0;
			} });
		} catch {}
	}
	return Gi;
}
function qi(e) {
	let t = e.parentNode, n = [], r = document.scrollingElement || document.documentElement;
	for (; t instanceof HTMLElement && t !== r;) (t.offsetHeight < t.scrollHeight || t.offsetWidth < t.scrollWidth) && n.push({
		element: t,
		scrollTop: t.scrollTop,
		scrollLeft: t.scrollLeft
	}), t = t.parentNode;
	return r instanceof HTMLElement && n.push({
		element: r,
		scrollTop: r.scrollTop,
		scrollLeft: r.scrollLeft
	}), n;
}
function Ji(e) {
	for (let { element: t, scrollTop: n, scrollLeft: r } of e) t.scrollTop = n, t.scrollLeft = r;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/domHelpers.mjs
var N = (e) => Zi(e) ? e.document : Qi(e) ? e : e?.ownerDocument ?? (typeof document < "u" ? document : void 0), Yi = (e) => N(e)?.defaultView ?? (typeof window < "u" ? window : void 0);
function Xi(e) {
	return typeof e == "object" && !!e && "nodeType" in e && typeof e.nodeType == "number";
}
function Zi(e) {
	return typeof e == "object" && !!e && "window" in e && e.window === e;
}
function Qi(e) {
	return Xi(e) && e.nodeType === 9;
}
function $i(e) {
	return Xi(e) && e.nodeType === 11 && "host" in e;
}
function ea(e, t, n, r) {
	if (n == null || e == null) return () => {};
	let i = Array.isArray(e) ? e : [e];
	for (let e of i) e.addEventListener(t, n, r);
	return () => {
		for (let e of i) e.removeEventListener(t, n, r);
	};
}
function ta(e, t, n, r) {
	if (e == null) return () => {};
	let i = [], a = Array.isArray(e) ? e : [e];
	for (let e of a) {
		let a = e.style.getPropertyValue(t), o = e.style.getPropertyPriority(t);
		e.style.setProperty(t, n, r), i.unshift(() => {
			a ? e.style.setProperty(t, a, o) : e.style.removeProperty(t);
		});
	}
	return () => {
		for (let e of i) e();
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/flags/flags.mjs
var na = !1;
function ra() {
	return na;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/shadowdom/DOMFunctions.mjs
function P(e, t) {
	if (!ra()) return t && e ? e.contains(t) : !1;
	if (!e || !t) return !1;
	let n = t;
	for (; n !== null;) {
		if (n === e) return !0;
		n = typeof n.assignedElements != "function" && n.assignedSlot?.parentNode ? n.assignedSlot.parentNode : $i(n) ? n.host : n.parentNode;
	}
	return !1;
}
var ia = (e = document) => {
	if (!ra()) return e.activeElement;
	let t = e.activeElement;
	for (; t && "shadowRoot" in t && t.shadowRoot?.activeElement;) t = t.shadowRoot.activeElement;
	return t;
};
function F(e) {
	if (ra() && e.target instanceof Element && e.target.shadowRoot) {
		if ("composedPath" in e) return e.composedPath()[0] ?? null;
		if ("composedPath" in e.nativeEvent) return e.nativeEvent.composedPath()[0] ?? null;
	}
	return e.target;
}
function aa(e, t) {
	if (t === null) return [];
	t ??= Yi(e);
	let n = [t];
	if (!ra() || !e || e === t) return n;
	let r = "getRootNode" in t ? t.getRootNode() : null, i = e.getRootNode() ?? null;
	for (; $i(i) && i !== r;) n.push(i), i = i.host.getRootNode();
	return n;
}
function oa(e) {
	if (!e) return !1;
	let t = e.getRootNode(), n = Yi(e);
	if (!(t instanceof n.Document || t instanceof n.ShadowRoot)) return !1;
	let r = t.activeElement;
	return r != null && e.contains(r);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/isElementVisible.mjs
var sa = typeof Element < "u" && "checkVisibility" in Element.prototype;
function ca(e) {
	let t = Yi(e);
	if (!(e instanceof t.HTMLElement) && !(e instanceof t.SVGElement)) return !1;
	let { display: n, visibility: r } = e.style, i = n !== "none" && r !== "hidden" && r !== "collapse";
	if (i) {
		let { getComputedStyle: t } = Yi(e), { display: n, visibility: r } = t(e);
		i = n !== "none" && r !== "hidden" && r !== "collapse";
	}
	return i;
}
function I(e, t) {
	return !e.hasAttribute("hidden") && !e.hasAttribute("data-react-aria-prevent-focus") && (e.nodeName === "DETAILS" && t && t.nodeName !== "SUMMARY" ? e.hasAttribute("open") : !0);
}
function la(e, t) {
	return sa ? e.checkVisibility({ visibilityProperty: !0 }) && !e.closest("[data-react-aria-prevent-focus]") : e.nodeName !== "#comment" && ca(e) && I(e, t) && (!e.parentElement || la(e.parentElement, e));
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/isFocusable.mjs
var ua = [
	"input:not([disabled]):not([type=hidden])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	"button:not([disabled])",
	"a[href]",
	"area[href]",
	"summary",
	"iframe",
	"object",
	"embed",
	"audio[controls]",
	"video[controls]",
	"[contenteditable]:not([contenteditable^=\"false\"])",
	"permission"
], da = ua.join(":not([hidden]),") + ",[tabindex]:not([disabled]):not([hidden])";
ua.push("[tabindex]:not([tabindex=\"-1\"]):not([disabled])");
var fa = ua.join(":not([hidden]):not([tabindex=\"-1\"]),");
function pa(e, t) {
	return e.matches(da) && !ha(e) && (t?.skipVisibilityCheck || la(e));
}
function ma(e) {
	return e.matches(fa) && la(e) && !ha(e);
}
function ha(e) {
	let t = e;
	for (; t != null;) {
		if (t instanceof Yi(t).HTMLElement && t.inert) return !0;
		t = t.parentElement;
	}
	return !1;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/utils.mjs
function ga(e) {
	let t = e;
	return t.nativeEvent = e, t.isDefaultPrevented = () => t.defaultPrevented, t.isPropagationStopped = () => t.cancelBubble, t.persist = () => {}, t;
}
function _a(e, t) {
	Object.defineProperty(e, "target", { value: t }), Object.defineProperty(e, "currentTarget", { value: t });
}
function va(e) {
	let t = (0, _.useRef)({
		isFocused: !1,
		observer: null
	});
	return Nr(() => {
		let e = t.current;
		return () => {
			e.observer &&= (e.observer.disconnect(), null);
		};
	}, []), (0, _.useCallback)((n) => {
		let r = F(n);
		if (r instanceof HTMLButtonElement || r instanceof HTMLInputElement || r instanceof HTMLTextAreaElement || r instanceof HTMLSelectElement) {
			t.current.isFocused = !0;
			let n = r;
			n.addEventListener("focusout", (r) => {
				if (t.current.isFocused = !1, n.disabled) {
					let t = ga(r);
					e?.(t);
				}
				t.current.observer && (t.current.observer.disconnect(), t.current.observer = null);
			}, { once: !0 }), t.current.observer = new MutationObserver(() => {
				if (t.current.isFocused && n.disabled) {
					t.current.observer?.disconnect();
					let e = n === ia() ? null : ia();
					n.dispatchEvent(new FocusEvent("blur", { relatedTarget: e })), n.dispatchEvent(new FocusEvent("focusout", {
						bubbles: !0,
						relatedTarget: e
					}));
				}
			}), t.current.observer.observe(n, {
				attributes: !0,
				attributeFilter: ["disabled"]
			});
		}
	}, [e]);
}
var ya = !1;
function ba(e) {
	for (; e && !pa(e, { skipVisibilityCheck: !0 });) e = e.parentElement;
	let t = ia(Yi(e).document);
	if (!t || t === e) return;
	let n = e?.getRootNode(), r = n != null && $i(n) ? n : Yi(e), i = (t) => t === e || t != null && P(e, t), a = (e) => e === t || t != null && e != null && P(t, e);
	ya = !0;
	let o = !1, s = (e) => {
		(a(F(e)) || o) && e.stopImmediatePropagation();
	}, c = (n) => {
		(a(F(n)) || o) && (n.stopImmediatePropagation(), !e && !o && (o = !0, Wi(t), d()));
	}, l = (e) => {
		(i(F(e)) || o) && e.stopImmediatePropagation();
	}, u = (e) => {
		(i(F(e)) || o) && (e.stopImmediatePropagation(), o || (o = !0, Wi(t), d()));
	};
	r.addEventListener("blur", s, !0), r.addEventListener("focusout", c, !0), r.addEventListener("focusin", u, !0), r.addEventListener("focus", l, !0);
	let d = () => {
		cancelAnimationFrame(f), r.removeEventListener("blur", s, !0), r.removeEventListener("focusout", c, !0), r.removeEventListener("focusin", u, !0), r.removeEventListener("focus", l, !0), ya = !1, o = !1;
	}, f = requestAnimationFrame(d);
	return d;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/platform.mjs
function xa(e) {
	if (typeof window > "u" || window.navigator == null) return !1;
	let t = window.navigator.userAgentData?.brands;
	return Array.isArray(t) && t.some((t) => e.test(t.brand)) || e.test(window.navigator.userAgent);
}
function Sa(e) {
	return typeof window < "u" && window.navigator != null && e.test(window.navigator.userAgentData?.platform || window.navigator.platform);
}
function Ca(e) {
	let t = null;
	return () => (t ??= e(), t);
}
var wa = Ca(function() {
	return Sa(/^Mac/i);
}), Ta = Ca(function() {
	return Sa(/^iPhone/i);
}), Ea = Ca(function() {
	return Sa(/^iPad/i) || wa() && navigator.maxTouchPoints > 1;
}), Da = Ca(function() {
	return Ta() || Ea();
}), Oa = Ca(function() {
	return wa() || Da();
}), ka = Ca(function() {
	return xa(/AppleWebKit/i) && (Da() || !Aa());
}), Aa = Ca(function() {
	return xa(/Chrome|CriOS|CrMo/i);
}), ja = Ca(function() {
	return xa(/Android/i);
}), Ma = Ca(function() {
	return xa(/(Firefox|FxiOS)/i);
});
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/isVirtualEvent.mjs
function Na(e) {
	return e.pointerType === "" && e.isTrusted ? !0 : ja() && e.pointerType ? e.type === "click" && e.buttons === 1 : e.detail === 0 && !e.pointerType;
}
function Pa(e) {
	return !ja() && e.width === 0 && e.height === 0 || ja() && e.width === 1 && e.height === 1 && e.pressure === 0 && e.detail === 0 && e.pointerType === "mouse";
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/openLink.mjs
var Fa = /*#__PURE__*/ (0, _.createContext)({
	isNative: !0,
	open: Ba,
	useHref: (e) => e
});
function Ia() {
	return (0, _.useContext)(Fa);
}
function La(e, t) {
	let n = e.getAttribute("target");
	return (!n || n === "_self") && e.origin === location.origin && !e.hasAttribute("download") && !t.metaKey && !t.ctrlKey && !t.altKey && !t.shiftKey;
}
function Ra(e, t, n = !0) {
	let { metaKey: r, ctrlKey: i, altKey: a, shiftKey: o } = t;
	!ka() && Ma() && window.event?.type?.startsWith("key") && e.target === "_blank" && (wa() ? r = !0 : i = !0);
	let s = ka() && wa() && !Ea() ? new KeyboardEvent("keydown", {
		keyIdentifier: "Enter",
		metaKey: r,
		ctrlKey: i,
		altKey: a,
		shiftKey: o
	}) : new MouseEvent("click", {
		metaKey: r,
		ctrlKey: i,
		altKey: a,
		shiftKey: o,
		detail: 1,
		bubbles: !0,
		cancelable: !0
	});
	Ra.isOpening = n, Wi(e), e.dispatchEvent(s), Ra.isOpening = !1;
}
Ra.isOpening = !1;
function za(e, t) {
	if (e instanceof HTMLAnchorElement) t(e);
	else if (e.hasAttribute("data-href")) {
		let n = document.createElement("a");
		n.href = e.getAttribute("data-href"), e.hasAttribute("data-target") && (n.target = e.getAttribute("data-target")), e.hasAttribute("data-rel") && (n.rel = e.getAttribute("data-rel")), e.hasAttribute("data-download") && (n.download = e.getAttribute("data-download")), e.hasAttribute("data-ping") && (n.ping = e.getAttribute("data-ping")), e.hasAttribute("data-referrer-policy") && (n.referrerPolicy = e.getAttribute("data-referrer-policy")), e.appendChild(n), t(n), e.removeChild(n);
	}
}
function Ba(e, t) {
	za(e, (e) => Ra(e, t));
}
function Va(e) {
	let t = Ia().useHref(e?.href ?? ""), n = {};
	if (e) for (let r of [
		"href",
		"target",
		"rel",
		"download",
		"ping",
		"referrerPolicy"
	]) r in e && e[r] !== void 0 && (n[r] = r === "href" ? t : e[r]);
	return n;
}
function Ha(e, t, n, r) {
	!t.isNative && e.currentTarget instanceof HTMLAnchorElement && e.currentTarget.href && !e.isDefaultPrevented() && La(e.currentTarget, e) && n && (e.preventDefault(), t.open(e.currentTarget, e, n, r));
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useFocusVisible.mjs
var Ua = null, Wa = /* @__PURE__ */ new Set(), Ga = /* @__PURE__ */ new Map(), Ka = !1, qa = !1, Ja = {
	Tab: !0,
	Escape: !0
};
function Ya(e, t) {
	for (let n of Wa) n(e, t);
}
function Xa(e) {
	return !(e.metaKey || !wa() && e.altKey || e.ctrlKey || e.key === "Control" || e.key === "Shift" || e.key === "Meta");
}
function Za(e) {
	Ka = !0, !Ra.isOpening && Xa(e) && (Ua = "keyboard", Ya("keyboard", e));
}
function Qa(e) {
	Ua = "pointer", "pointerType" in e && e.pointerType, (e.type === "mousedown" || e.type === "pointerdown") && (Ka = !0, Ya("pointer", e));
}
function $a(e) {
	!Ra.isOpening && Na(e) && (Ka = !0, Ua = "virtual");
}
function eo(e) {
	if (ya) return;
	let t = F(e), n = Yi(t), r = N(t);
	if (t === n) {
		qa = !0;
		return;
	}
	t !== r && e.isTrusted && (!Ka && !qa && (Ua = "virtual", Ya("virtual", e)), Ka = !1, qa = !1);
}
function to() {
	ya || (Ka = !1, qa = !0);
}
function no(e) {
	if (typeof window > "u" || typeof document > "u") return;
	let t = Yi(e), n = N(e);
	if (Ga.get(t)) return;
	let r = t.HTMLElement.prototype.focus;
	Reflect.defineProperty(t.HTMLElement.prototype, "focus", {
		configurable: !0,
		writable: !0,
		value: function() {
			Ka = !0, r.apply(this, arguments);
		}
	}), n.addEventListener("keydown", Za, !0), n.addEventListener("keyup", Za, !0), n.addEventListener("click", $a, !0), t.addEventListener("focus", eo, !0), t.addEventListener("blur", to, !1), typeof PointerEvent < "u" && (n.addEventListener("pointerdown", Qa, !0), n.addEventListener("pointermove", Qa, !0), n.addEventListener("pointerup", Qa, !0)), t.addEventListener("beforeunload", () => {
		ro(e);
	}, { once: !0 }), Ga.set(t, { focus: r });
}
var ro = (e, t) => {
	let n = Yi(e), r = N(e);
	t && r.removeEventListener("DOMContentLoaded", t), Ga.has(n) && (Reflect.defineProperty(n.HTMLElement.prototype, "focus", {
		configurable: !0,
		writable: !0,
		value: Ga.get(n).focus
	}), r.removeEventListener("keydown", Za, !0), r.removeEventListener("keyup", Za, !0), r.removeEventListener("click", $a, !0), n.removeEventListener("focus", eo, !0), n.removeEventListener("blur", to, !1), typeof PointerEvent < "u" && (r.removeEventListener("pointerdown", Qa, !0), r.removeEventListener("pointermove", Qa, !0), r.removeEventListener("pointerup", Qa, !0)), Ga.delete(n));
};
function io(e) {
	let t = N(e), n;
	return t.readyState === "loading" ? (n = () => {
		no(e);
	}, t.addEventListener("DOMContentLoaded", n)) : no(e), () => ro(e, n);
}
typeof document < "u" && io();
function ao() {
	return Ua !== "pointer";
}
function oo() {
	return Ua;
}
function so(e) {
	Ua = e, Ya(e, null);
}
var co = /* @__PURE__ */ new Set([
	"checkbox",
	"radio",
	"range",
	"color",
	"file",
	"image",
	"button",
	"submit",
	"reset"
]);
function lo(e, t, n) {
	let r = n ? F(n) : void 0, i = N(r), a = Yi(r), o = a === void 0 ? HTMLInputElement : a.HTMLInputElement, s = a === void 0 ? HTMLTextAreaElement : a.HTMLTextAreaElement, c = a === void 0 ? HTMLElement : a.HTMLElement, l = a === void 0 ? KeyboardEvent : a.KeyboardEvent, u = ia(i);
	return e = e || u instanceof o && !co.has(u.type) || u instanceof s || u instanceof c && u.isContentEditable, !(e && t === "keyboard" && n instanceof l && !Ja[n.key]);
}
function uo(e, t, n) {
	no(), (0, _.useEffect)(() => {
		if (n?.enabled === !1) return;
		let t = (t, r) => {
			lo(!!n?.isTextInput, t, r) && e(ao());
		};
		return Wa.add(t), () => {
			Wa.delete(t);
		};
	}, t);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/runAfterTransition.mjs
var fo = /* @__PURE__ */ new Map(), po = /* @__PURE__ */ new Set();
function mo() {
	if (typeof window > "u") return;
	function e(e) {
		return "propertyName" in e;
	}
	let t = (t) => {
		let r = F(t);
		if (!e(t) || !r) return;
		let i = fo.get(r);
		i || (i = /* @__PURE__ */ new Set(), fo.set(r, i), r.addEventListener("transitioncancel", n, { once: !0 })), i.add(t.propertyName);
	}, n = (t) => {
		let r = F(t);
		if (!e(t) || !r) return;
		let i = fo.get(r);
		if (i && (i.delete(t.propertyName), i.size === 0 && (r.removeEventListener("transitioncancel", n), fo.delete(r)), fo.size === 0)) {
			for (let e of po) e();
			po.clear();
		}
	};
	document.body.addEventListener("transitionrun", t), document.body.addEventListener("transitionend", n);
}
typeof document < "u" && (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", mo) : mo());
function ho() {
	for (let [e] of fo) "isConnected" in e && !e.isConnected && fo.delete(e);
}
function go(e) {
	requestAnimationFrame(() => {
		ho(), fo.size === 0 ? e() : po.add(e);
	});
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/focusSafely.mjs
function _o(e) {
	if (!e.isConnected) return;
	let t = N(e);
	if (oo() === "virtual") {
		let n = ia(t);
		go(() => {
			let r = ia(t);
			(r === n || r === t.body) && e.isConnected && Wi(e);
		});
	} else Wi(e);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useFocus.mjs
function vo(e) {
	let { isDisabled: t, onFocus: n, onBlur: r, onFocusChange: i } = e, a = (0, _.useCallback)((e) => {
		if (F(e) === e.currentTarget) return r && r(e), i && i(!1), !0;
	}, [r, i]), o = va(a), s = (0, _.useCallback)((e) => {
		let t = F(e), r = N(t), a = r ? ia(r) : ia();
		t === e.currentTarget && t === a && (n && n(e), i && i(!0), o(e));
	}, [
		i,
		n,
		o
	]);
	return { focusProps: {
		onFocus: !t && (n || i || r) ? s : void 0,
		onBlur: !t && (r || i) ? a : void 0
	} };
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/createEventHandler.mjs
function yo(e) {
	if (e) return (t) => {
		let n = !0;
		e({
			...t,
			preventDefault() {
				t.preventDefault();
			},
			isDefaultPrevented() {
				return t.isDefaultPrevented();
			},
			stopPropagation() {
				n = !0;
			},
			continuePropagation() {
				n = !1, typeof t.continuePropagation == "function" && t.continuePropagation();
			},
			isPropagationStopped() {
				return n;
			}
		}), n && !(typeof t.isPropagationStopped == "function" && t.isPropagationStopped()) && t.stopPropagation();
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/createKeyboardShortcutHandler.mjs
var bo = /* @__PURE__ */ new Set([
	"shift",
	"alt",
	"control",
	"meta",
	"mod"
]), xo = [
	"Alt",
	"Control",
	"Meta",
	"Shift"
];
function So(e) {
	let t = /* @__PURE__ */ new Set();
	return e.alt && t.add("Alt"), e.shift && t.add("Shift"), e.ctrl && t.add("Control"), e.meta && t.add("Meta"), e.mod && t.add(wa() ? "Meta" : "Control"), t;
}
function Co(e) {
	let t = /* @__PURE__ */ new Set();
	return e.altKey && t.add("Alt"), e.ctrlKey && t.add("Control"), e.metaKey && t.add("Meta"), e.shiftKey && t.add("Shift"), t;
}
function wo(e) {
	return xo.filter((t) => e.has(t));
}
function To(e) {
	let t = e.split("+").reduce((e, t) => {
		let n = t.toLowerCase();
		return bo.has(n) ? n === "shift" ? e.shift = !0 : n === "alt" ? e.alt = !0 : n === "control" ? e.ctrl = !0 : n === "meta" ? e.meta = !0 : n === "mod" && (e.mod = !0) : e.key = t, e;
	}, {
		shift: !1,
		alt: !1,
		ctrl: !1,
		meta: !1,
		mod: !1,
		key: ""
	});
	if (t.key === "") throw Error(`Invalid keyboard shortcut: "${e}". Must include exactly one non-modifier key (e.g. "a", "Enter", "ArrowDown"). Combine any of Shift, Alt, Ctrl, Meta, and Mod.`);
	return t;
}
function Eo(e) {
	return e.toLowerCase();
}
var Do = {
	space: " ",
	esc: "escape",
	del: "delete",
	ins: "insert",
	left: "arrowleft",
	right: "arrowright",
	up: "arrowup",
	down: "arrowdown",
	pageup: "pageup",
	pagedown: "pagedown"
};
function Oo(e) {
	let t = Eo(e);
	return Do[t] ?? t;
}
function ko(e) {
	let t = wo(So(e)), n = Oo(e.key);
	return t.length > 0 ? `${t.join("+")}+${n}` : n;
}
function Ao(e) {
	let t = wo(Co(e)), n = Eo(e.key);
	return (t.length > 0 ? `${t.join("+")}+` : "") + n;
}
function jo(e) {
	let t = /* @__PURE__ */ new Map();
	for (let [n, r] of Object.entries(e)) {
		let e = To(n);
		t.set(ko(e), r);
	}
	return (e) => {
		let n = Ao(e), r = t.get(n), i = r?.(e);
		i === void 0 && r !== void 0 ? i = {
			shouldContinuePropagation: !1,
			shouldPreventDefault: !0
		} : typeof i == "boolean" && (i = {
			shouldContinuePropagation: !i,
			shouldPreventDefault: i
		}), i?.shouldPreventDefault && e.preventDefault(), (!r || i?.shouldContinuePropagation) && e.continuePropagation();
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useKeyboard.mjs
function Mo(e) {
	let { shortcuts: t, allowRepeats: n = !1, allowComposing: r = !1 } = e, i, a;
	if (t) {
		let o = jo(t), s = yo((e) => {
			if (!P(e.currentTarget, F(e))) {
				e.continuePropagation();
				return;
			}
			if (e.nativeEvent?.repeat && !n || e.nativeEvent?.isComposing && !r) {
				e.continuePropagation();
				return;
			}
			o(e);
		}), c = yo((e) => {
			if (!P(e.currentTarget, F(e))) {
				e.continuePropagation();
				return;
			}
			if (e.nativeEvent?.repeat && !n || e.nativeEvent?.isComposing && !r) {
				e.continuePropagation();
				return;
			}
			e.continuePropagation();
		});
		i = e.onKeyDown ? Mr(e.onKeyDown, s) : s, a = e.onKeyUp ? Mr(e.onKeyUp, c) : c;
	} else i = yo(e.onKeyDown), a = yo(e.onKeyUp);
	return { keyboardProps: e.isDisabled ? {} : {
		onKeyDown: i,
		onKeyUp: a
	} };
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useSyncRef.mjs
function No(e, t) {
	Nr(() => {
		if (e && e.ref && t) return e.ref.current = t.current, () => {
			e.ref && (e.ref.current = null);
		};
	});
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useFocusable.mjs
var Po = /*#__PURE__*/ _.createContext(null);
function Fo(e) {
	let t = (0, _.useContext)(Po) || {};
	No(t, e);
	let { ref: n, ...r } = t;
	return r;
}
function Io(e, t) {
	let { focusProps: n } = vo(e), { keyboardProps: r } = Mo(e), i = ii(n, r), a = Fo(t), o = e.isDisabled ? {} : a, s = (0, _.useRef)(e.autoFocus);
	(0, _.useEffect)(() => {
		s.current && t.current && _o(t.current), s.current = !1;
	}, [t]);
	let c = e.excludeFromTabOrder ? -1 : 0;
	return e.isDisabled && (c = void 0), { focusableProps: ii({
		...i,
		tabIndex: c
	}, o) };
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/textSelection.mjs
var Lo = "default", Ro = "", zo = /* @__PURE__ */ new WeakMap();
function Bo(e) {
	if (Da() && ka()) {
		if (Lo === "default") {
			let t = N(e);
			Ro = t.documentElement.style.webkitUserSelect, t.documentElement.style.webkitUserSelect = "none";
		}
		Lo = "disabled";
	} else if (e instanceof HTMLElement || e instanceof SVGElement) {
		let t = "userSelect" in e.style ? "userSelect" : "webkitUserSelect";
		zo.set(e, e.style[t]), e.style[t] = "none";
	}
}
function Vo(e) {
	if (Da() && ka()) {
		if (Lo !== "disabled") return;
		Lo = "restoring", setTimeout(() => {
			go(() => {
				if (Lo === "restoring") {
					let t = N(e);
					t.documentElement.style.webkitUserSelect === "none" && (t.documentElement.style.webkitUserSelect = Ro || ""), Ro = "", Lo = "default";
				}
			});
		}, 300);
	} else if ((e instanceof HTMLElement || e instanceof SVGElement) && e && zo.has(e)) {
		let t = zo.get(e), n = "userSelect" in e.style ? "userSelect" : "webkitUserSelect";
		e.style[n] === "none" && (e.style[n] = t), e.getAttribute("style") === "" && e.removeAttribute("style"), zo.delete(e);
	}
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/getMetaValue.mjs
function Ho(e, t) {
	let n = Yi(t), r = N(t);
	if (r == null || n == null) return;
	let i, a = `meta[name="${CSS.escape(e)}"], meta[property="${CSS.escape(e)}"]`, o = r.querySelector(a);
	return o && o instanceof n.HTMLMetaElement && (e === "csp-nonce" && o.nonce && (i ??= o.nonce || void 0), o.content && (i ??= o.content || void 0)), e === "csp-nonce" && (i ??= n.__webpack_nonce__ || globalThis.__webpack_nonce__ || void 0), i;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/getNonce.mjs
var Uo = /* @__PURE__ */ new WeakMap();
function Wo(e) {
	let t = N(e), n = Uo.get(t);
	return n ??= Ho("csp-nonce", t), n !== void 0 && Uo.set(t, n), n;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/context.mjs
var Go = _.createContext({ register: () => {} });
Go.displayName = "PressResponderContext";
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useEffectEvent.mjs
var Ko = _.useInsertionEffect ?? Nr;
function L(e) {
	let t = (0, _.useRef)(null);
	return Ko(() => {
		t.current = e;
	}, [e]), (0, _.useCallback)((...e) => {
		let n = t.current;
		return n?.(...e);
	}, []);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useGlobalListeners.mjs
function qo() {
	let e = (0, _.useRef)(/* @__PURE__ */ new Map()), t = (0, _.useCallback)((t, n, r, i) => {
		let a = i?.once ? (...t) => {
			e.current.delete(r), r(...t);
		} : r;
		e.current.set(r, {
			type: n,
			eventTarget: t,
			fn: a,
			options: i
		}), t.addEventListener(n, a, i);
	}, []), n = (0, _.useCallback)((t, n, r, i) => {
		let a = e.current.get(r)?.fn || r;
		t.removeEventListener(n, a, i), e.current.delete(r);
	}, []), r = (0, _.useCallback)(() => {
		e.current.forEach((e, t) => {
			n(e.eventTarget, e.type, t, e.options);
		});
	}, [n]);
	return (0, _.useEffect)(() => r, [r]), {
		addGlobalListener: t,
		removeGlobalListener: n,
		removeAllGlobalListeners: r
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/usePress.mjs
var Jo = /* @__PURE__ */ c(m(), 1);
function Yo(e) {
	let t = (0, _.useContext)(Go);
	if (t) {
		let { register: n, ref: r, ...i } = t;
		e = ii(i, e), n();
	}
	return No(t, e.ref), e;
}
var Xo = class {
	#e;
	constructor(e, t, n, r) {
		this.#e = !0;
		let i = (r?.target ?? n.currentTarget)?.getBoundingClientRect(), a, o = 0, s, c = null;
		n.clientX != null && n.clientY != null && (s = n.clientX, c = n.clientY), i && (s != null && c != null ? (a = s - i.left, o = c - i.top) : (a = i.width / 2, o = i.height / 2)), this.type = e, this.pointerType = t, this.target = n.currentTarget, this.shiftKey = n.shiftKey, this.metaKey = n.metaKey, this.ctrlKey = n.ctrlKey, this.altKey = n.altKey, this.x = a, this.y = o, this.key = n.key;
	}
	continuePropagation() {
		this.#e = !1;
	}
	get shouldStopPropagation() {
		return this.#e;
	}
}, Zo = Symbol("linkClicked"), Qo = "react-aria-pressable-style", $o = "data-react-aria-pressable";
function es(e) {
	let { onPress: t, onPressChange: n, onPressStart: r, onPressEnd: i, onPressUp: a, onClick: o, isDisabled: s, isPressed: c, preventFocusOnPress: l, shouldCancelOnPointerExit: u, allowTextSelectionOnPress: d, ref: f, ...p } = Yo(e), [m, h] = (0, _.useState)(!1), g = (0, _.useRef)({
		isPressed: !1,
		ignoreEmulatedMouseEvents: !1,
		didFirePressStart: !1,
		isTriggeringEvent: !1,
		activePointerId: null,
		target: null,
		isOverTarget: !1,
		pointerType: null,
		disposables: []
	}), { addGlobalListener: v, removeAllGlobalListeners: y } = qo(), b = (0, _.useCallback)((e, t) => {
		let i = g.current;
		if (s || i.didFirePressStart) return !1;
		let a = !0;
		if (i.isTriggeringEvent = !0, r) {
			let n = new Xo("pressstart", t, e);
			r(n), a = n.shouldStopPropagation;
		}
		return n && n(!0), i.isTriggeringEvent = !1, i.didFirePressStart = !0, h(!0), a;
	}, [
		s,
		r,
		n
	]), x = (0, _.useCallback)((e, r, a = !0) => {
		let o = g.current;
		if (!o.didFirePressStart) return !1;
		o.didFirePressStart = !1, o.isTriggeringEvent = !0;
		let c = !0;
		if (i) {
			let t = new Xo("pressend", r, e);
			i(t), c = t.shouldStopPropagation;
		}
		if (n && n(!1), h(!1), t && a && !s) {
			let n = new Xo("press", r, e);
			t(n), c &&= n.shouldStopPropagation;
		}
		return o.isTriggeringEvent = !1, c;
	}, [
		s,
		i,
		n,
		t
	]), S = L(x), C = L((0, _.useCallback)((e, t) => {
		let n = g.current;
		if (s) return !1;
		if (a) {
			n.isTriggeringEvent = !0;
			let r = new Xo("pressup", t, e);
			return a(r), n.isTriggeringEvent = !1, r.shouldStopPropagation;
		}
		return !0;
	}, [s, a])), w = (0, _.useCallback)((e) => {
		let t = g.current;
		if (t.isPressed && t.target) {
			t.didFirePressStart && t.pointerType != null && x(rs(t.target, e), t.pointerType, !1), t.isPressed = !1, t.isOverTarget = !1, t.activePointerId = null, t.pointerType = null, y(), d || Vo(t.target);
			for (let e of t.disposables) e();
			t.disposables = [];
		}
	}, [
		d,
		y,
		x
	]), T = L(w);
	(0, _.useEffect)(() => {
		s && g.current.isPressed && T({
			currentTarget: g.current.target,
			shiftKey: !1,
			ctrlKey: !1,
			metaKey: !1,
			altKey: !1
		});
	}, [s]);
	let ee = (0, _.useCallback)((e) => {
		u && w(e);
	}, [u, w]), E = (0, _.useCallback)((e) => {
		s || o?.(e);
	}, [s, o]), te = (0, _.useCallback)((e, t) => {
		if (!s && o) {
			let n = new MouseEvent("click", e);
			_a(n, t), o(ga(n));
		}
	}, [s, o]), D = (0, _.useMemo)(() => {
		let e = g.current, t = {
			onKeyDown(t) {
				if (ns(t.nativeEvent, t.currentTarget) && P(t.currentTarget, F(t))) {
					as(F(t), t.key) && t.preventDefault();
					let r = !0;
					!e.isPressed && !t.repeat && (e.target = t.currentTarget, e.isPressed = !0, e.pointerType = "keyboard", r = b(t, "keyboard"));
					let i = t.currentTarget;
					v(N(t.currentTarget), "keyup", Mr((t) => {
						ns(t, i) && !t.repeat && P(i, F(t)) && e.target && C(rs(e.target, t), "keyboard");
					}, n), !0), r && t.stopPropagation(), t.metaKey && wa() && e.metaKeyEvents?.set(t.key, t.nativeEvent);
				} else t.key === "Meta" && (e.metaKeyEvents = /* @__PURE__ */ new Map());
			},
			onClick(t) {
				if ((!t || P(t.currentTarget, F(t))) && t && t.button === 0 && !e.isTriggeringEvent && !Ra.isOpening) {
					let n = !0;
					if (s && t.preventDefault(), !e.ignoreEmulatedMouseEvents && !e.isPressed && (e.pointerType === "virtual" || Na(t.nativeEvent))) {
						let e = b(t, "virtual"), r = C(t, "virtual"), i = S(t, "virtual");
						E(t), n = e && r && i;
					} else if (e.isPressed && e.pointerType !== "keyboard") {
						let r = e.pointerType || t.nativeEvent.pointerType || "virtual", i = C(rs(t.currentTarget, t), r), a = S(rs(t.currentTarget, t), r, !0);
						n = i && a, e.isOverTarget = !1, E(t), T(t);
					}
					e.ignoreEmulatedMouseEvents = !1, n && t.stopPropagation();
				}
			}
		}, n = (t) => {
			if (e.isPressed && e.target && ns(t, e.target)) {
				as(F(t), t.key) && t.preventDefault();
				let n = F(t), r = P(e.target, n);
				S(rs(e.target, t), "keyboard", r), r && te(t, e.target), y(), t.key !== "Enter" && ts(e.target) && P(e.target, n) && !t[Zo] && (t[Zo] = !0, Ra(e.target, t, !1)), e.isPressed = !1, e.metaKeyEvents?.delete(t.key);
			} else if (t.key === "Meta" && e.metaKeyEvents?.size) {
				let t = e.metaKeyEvents;
				e.metaKeyEvents = void 0;
				for (let n of t.values()) e.target?.dispatchEvent(new KeyboardEvent("keyup", n));
			}
		};
		if (typeof PointerEvent < "u") {
			t.onPointerDown = (t) => {
				if (t.button !== 0 || !P(t.currentTarget, F(t))) return;
				if (Pa(t.nativeEvent)) {
					e.pointerType = "virtual";
					return;
				}
				e.pointerType = t.pointerType;
				let i = !0;
				if (!e.isPressed) {
					e.isPressed = !0, e.isOverTarget = !0, e.activePointerId = t.pointerId, e.target = t.currentTarget, d || Bo(e.target), i = b(t, e.pointerType);
					let a = F(t);
					"releasePointerCapture" in a && ("hasPointerCapture" in a ? a.hasPointerCapture(t.pointerId) && a.releasePointerCapture(t.pointerId) : a.releasePointerCapture(t.pointerId)), v(N(t.currentTarget), "pointerup", n, !1), v(N(t.currentTarget), "pointercancel", r, !1);
				}
				i && t.stopPropagation();
			}, t.onMouseDown = (t) => {
				if (P(t.currentTarget, F(t)) && t.button === 0) {
					if (l) {
						let n = ba(t.target);
						n && e.disposables.push(n);
					}
					t.stopPropagation();
				}
			}, t.onPointerUp = (t) => {
				P(t.currentTarget, F(t)) && e.pointerType !== "virtual" && t.button === 0 && !e.isPressed && C(t, e.pointerType || t.pointerType);
			}, t.onPointerEnter = (t) => {
				t.pointerId === e.activePointerId && e.target && !e.isOverTarget && e.pointerType != null && (e.isOverTarget = !0, b(rs(e.target, t), e.pointerType));
			}, t.onPointerLeave = (t) => {
				t.pointerId === e.activePointerId && e.target && e.isOverTarget && e.pointerType != null && (e.isOverTarget = !1, S(rs(e.target, t), e.pointerType, !1), ee(t));
			};
			let n = (t) => {
				if (t.pointerId === e.activePointerId && e.isPressed && t.button === 0 && e.target) {
					if (P(e.target, F(t)) && e.pointerType != null) {
						let n = !1, r = setTimeout(() => {
							e.isPressed && e.target instanceof HTMLElement && (n ? T(t) : (Wi(e.target), e.target.click()));
						}, 80);
						v(t.currentTarget, "click", () => n = !0, !0), e.disposables.push(() => clearTimeout(r));
					} else T(t);
					e.isOverTarget = !1;
				}
			}, r = (e) => {
				T(e);
			};
			t.onDragStart = (e) => {
				P(e.currentTarget, F(e)) && T(e);
			};
		}
		return t;
	}, [
		v,
		s,
		l,
		y,
		d,
		ee,
		b,
		E,
		te
	]);
	return (0, _.useEffect)(() => {
		if (!f) return;
		let e = N(f.current);
		if (!e || !e.head || e.getElementById(Qo)) return;
		let t = e.createElement("style");
		t.id = Qo;
		let n = Wo(e);
		n && (t.nonce = n), t.textContent = `
@layer {
  [${$o}] {
    touch-action: pan-x pan-y pinch-zoom;
  }
}
    `.trim(), e.head.prepend(t);
	}, [f]), (0, _.useEffect)(() => {
		let e = g.current;
		return () => {
			d || Vo(e.target ?? void 0);
			for (let t of e.disposables) t();
			e.disposables = [];
		};
	}, [d]), {
		isPressed: c || m,
		pressProps: ii(p, D, { [$o]: !0 })
	};
}
function ts(e) {
	return e.tagName === "A" && e.hasAttribute("href");
}
function ns(e, t) {
	let { key: n, code: r } = e, i = t, a = i.getAttribute("role");
	return (n === "Enter" || n === " " || n === "Spacebar" || r === "Space") && !(i instanceof Yi(i).HTMLInputElement && !ss(i, n) || i instanceof Yi(i).HTMLTextAreaElement || i.isContentEditable) && !((a === "link" || !a && ts(i)) && n !== "Enter");
}
function rs(e, t) {
	let n = t.clientX, r = t.clientY;
	return {
		currentTarget: e,
		shiftKey: t.shiftKey,
		ctrlKey: t.ctrlKey,
		metaKey: t.metaKey,
		altKey: t.altKey,
		clientX: n,
		clientY: r,
		key: t.key
	};
}
function is(e) {
	return e instanceof HTMLInputElement ? !1 : e instanceof HTMLButtonElement ? e.type !== "submit" && e.type !== "reset" : !ts(e);
}
function as(e, t) {
	return wa() && t === "Enter" ? !1 : e instanceof HTMLInputElement ? t === "Enter" && (e.type === "checkbox" || e.type === "radio") ? !1 : !ss(e, t) : is(e);
}
var os = /* @__PURE__ */ new Set([
	"checkbox",
	"radio",
	"range",
	"color",
	"file",
	"image",
	"button",
	"submit",
	"reset"
]);
function ss(e, t) {
	return e.type === "checkbox" || e.type === "radio" ? t === " " : os.has(e.type);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/button/useButton.mjs
function cs(e, t) {
	let { elementType: n = "button", isDisabled: r, onPress: i, onPressStart: a, onPressEnd: o, onPressUp: s, onPressChange: c, preventFocusOnPress: l, allowFocusWhenDisabled: u, onClick: d, href: f, target: p, rel: m, type: h = "button" } = e, g;
	g = n === "button" ? {
		type: h,
		disabled: r,
		form: e.form,
		formAction: e.formAction,
		formEncType: e.formEncType,
		formMethod: e.formMethod,
		formNoValidate: e.formNoValidate,
		formTarget: e.formTarget,
		name: e.name,
		value: e.value
	} : {
		role: "button",
		href: n === "a" && !r ? f : void 0,
		target: n === "a" ? p : void 0,
		type: n === "input" ? h : void 0,
		disabled: n === "input" ? r : void 0,
		"aria-disabled": !r || n === "input" ? void 0 : r,
		rel: n === "a" ? m : void 0
	};
	let { pressProps: _, isPressed: v } = es({
		onPressStart: a,
		onPressEnd: o,
		onPressChange: c,
		onPress: i,
		onPressUp: s,
		onClick: d,
		isDisabled: r,
		preventFocusOnPress: l,
		ref: t
	}), { focusableProps: y } = Io(e, t);
	u && (y.tabIndex = r ? -1 : y.tabIndex);
	let b = ii(y, _, Ti(e, { labelable: !0 }));
	return {
		isPressed: v,
		buttonProps: ii(g, b, {
			"aria-haspopup": e["aria-haspopup"],
			"aria-expanded": e["aria-expanded"],
			"aria-controls": e["aria-controls"],
			"aria-pressed": e["aria-pressed"],
			"aria-current": e["aria-current"],
			"aria-disabled": e["aria-disabled"]
		})
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useFocusWithin.mjs
function ls(e) {
	let { isDisabled: t, onBlurWithin: n, onFocusWithin: r, onFocusWithinChange: i } = e, a = (0, _.useRef)({ isFocusWithin: !1 }), { addGlobalListener: o, removeAllGlobalListeners: s } = qo(), c = (0, _.useCallback)((e) => {
		P(e.currentTarget, F(e)) && a.current.isFocusWithin && !P(e.currentTarget, e.relatedTarget) && (a.current.isFocusWithin = !1, s(), n && n(e), i && i(!1));
	}, [
		n,
		i,
		a,
		s
	]), l = va(c), u = (0, _.useCallback)((e) => {
		if (!P(e.currentTarget, F(e))) return;
		let t = F(e), n = N(t), s = ia(n);
		if (!a.current.isFocusWithin && s === t) {
			r && r(e), i && i(!0), a.current.isFocusWithin = !0, l(e);
			let t = e.currentTarget;
			o(n, "focus", (e) => {
				let r = F(e);
				if (a.current.isFocusWithin && !P(t, r)) {
					let e = new n.defaultView.FocusEvent("blur", { relatedTarget: r });
					_a(e, t);
					let i = ga(e);
					c(i);
				}
			}, { capture: !0 });
		}
	}, [
		r,
		i,
		l,
		o,
		c
	]);
	return t ? { focusWithinProps: {
		onFocus: void 0,
		onBlur: void 0
	} } : { focusWithinProps: {
		onFocus: u,
		onBlur: c
	} };
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/focus/useFocusRing.mjs
function us(e = {}) {
	let { autoFocus: t = !1, isTextInput: n, within: r } = e, i = (0, _.useRef)({
		isFocused: !1,
		isFocusVisible: t || ao()
	}), [a, o] = (0, _.useState)(!1), [s, c] = (0, _.useState)(() => i.current.isFocused && i.current.isFocusVisible), l = (0, _.useCallback)(() => c(i.current.isFocused && i.current.isFocusVisible), []), u = (0, _.useCallback)((e) => {
		i.current.isFocused = e, i.current.isFocusVisible = ao(), o(e), l();
	}, [l]);
	uo((e) => {
		i.current.isFocusVisible = e, l();
	}, [n, a], {
		enabled: a,
		isTextInput: n
	});
	let { focusProps: d } = vo({
		isDisabled: r,
		onFocusChange: u
	}), { focusWithinProps: f } = ls({
		isDisabled: !r,
		onFocusWithinChange: u
	});
	return {
		isFocused: a,
		isFocusVisible: s,
		focusProps: r ? f : d
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useHover.mjs
var ds = !1, fs = 0;
function ps() {
	ds = !0, setTimeout(() => {
		ds = !1;
	}, 500);
}
function ms(e) {
	e.pointerType === "touch" && ps();
}
function hs() {
	let e = N(null);
	if (e !== void 0) return fs === 0 && typeof PointerEvent < "u" && e.addEventListener("pointerup", ms), fs++, () => {
		fs--, !(fs > 0) && typeof PointerEvent < "u" && e.removeEventListener("pointerup", ms);
	};
}
function gs(e) {
	let { onHoverStart: t, onHoverChange: n, onHoverEnd: r, isDisabled: i } = e, [a, o] = (0, _.useState)(!1), s = (0, _.useRef)({
		isHovered: !1,
		ignoreEmulatedMouseEvents: !1,
		pointerType: "",
		target: null
	}).current;
	(0, _.useEffect)(hs, []);
	let { addGlobalListener: c, removeAllGlobalListeners: l } = qo(), { hoverProps: u, triggerHoverEnd: d } = (0, _.useMemo)(() => {
		let e = (e, r) => {
			if (s.pointerType = r, i || r === "touch" || s.isHovered || !P(e.currentTarget, F(e))) return;
			s.isHovered = !0;
			let l = e.currentTarget;
			s.target = l, c(N(F(e)), "pointerover", (e) => {
				s.isHovered && s.target && !P(s.target, F(e)) && a(e, e.pointerType);
			}, { capture: !0 }), t && t({
				type: "hoverstart",
				target: l,
				pointerType: r
			}), n && n(!0), o(!0);
		}, a = (e, t) => {
			let i = s.target;
			s.pointerType = "", s.target = null, t !== "touch" && s.isHovered && i && (s.isHovered = !1, l(), r && r({
				type: "hoverend",
				target: i,
				pointerType: t
			}), n && n(!1), o(!1));
		}, u = {};
		return typeof PointerEvent < "u" && (u.onPointerEnter = (t) => {
			ds && t.pointerType === "mouse" || e(t, t.pointerType);
		}, u.onPointerLeave = (e) => {
			!i && P(e.currentTarget, F(e)) && a(e, e.pointerType);
		}), {
			hoverProps: u,
			triggerHoverEnd: a
		};
	}, [
		t,
		n,
		r,
		i,
		s,
		c,
		l
	]);
	return (0, _.useEffect)(() => {
		i && d({ currentTarget: s.target }, s.pointerType);
	}, [i]), {
		hoverProps: u,
		isHovered: a
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria-components/dist/private/Button.mjs
var _s = /*#__PURE__*/ (0, _.createContext)({}), vs = /*#__PURE__*/ _i(function(e, t) {
	[e, t] = ui(e, t, _s);
	let n = e, { isPending: r } = n, { buttonProps: i, isPressed: a } = cs(e, t);
	i = bs(i, r);
	let { focusProps: o, isFocused: s, isFocusVisible: c } = us(e), { hoverProps: l, isHovered: u } = gs({
		...e,
		isDisabled: e.isDisabled || r
	}), d = {
		isHovered: u,
		isPressed: (n.isPressed || a) && !r,
		isFocused: s,
		isFocusVisible: c,
		isDisabled: e.isDisabled || !1,
		isPending: r ?? !1
	}, f = ci({
		...e,
		values: d,
		defaultClassName: "react-aria-Button"
	}), p = Zr(i.id), m = Zr(), h = i["aria-labelledby"];
	r && (h ? h = `${h} ${m}` : i["aria-label"] && (h = `${p} ${m}`));
	let g = (0, _.useRef)(r);
	(0, _.useEffect)(() => {
		let e = { "aria-labelledby": h || p };
		(!g.current && s && r || g.current && s && !r) && Hi(e, "assertive"), g.current = r;
	}, [
		r,
		s,
		h,
		p
	]);
	let v = Ti(e, { global: !0 });
	return delete v.onClick, /*#__PURE__*/ _.createElement(mi.button, {
		...ii(v, f, i, o, l),
		type: i.type === "submit" && r ? "button" : i.type,
		id: p,
		ref: t,
		"aria-labelledby": h,
		slot: e.slot || void 0,
		"aria-disabled": r ? "true" : i["aria-disabled"],
		"data-disabled": e.isDisabled || void 0,
		"data-pressed": d.isPressed || void 0,
		"data-hovered": u || void 0,
		"data-focused": s || void 0,
		"data-pending": r || void 0,
		"data-focus-visible": c || void 0
	}, /*#__PURE__*/ _.createElement(zi.Provider, { value: { id: m } }, f.children));
}), ys = /Focus|Blur|Hover|Pointer(Enter|Leave|Over|Out)|Mouse(Enter|Leave|Over|Out)/;
function bs(e, t) {
	if (t) {
		for (let t in e) t.startsWith("on") && !ys.test(t) && (e[t] = void 0);
		e.href = void 0, e.target = void 0;
	}
	return e;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/collections/BaseCollection.mjs
var xs = class {
	constructor(e) {
		this.value = null, this.level = 0, this.hasChildNodes = !1, this.rendered = null, this.textValue = "", this["aria-label"] = void 0, this.index = 0, this.parentKey = null, this.prevKey = null, this.nextKey = null, this.firstChildKey = null, this.lastChildKey = null, this.props = {}, this.colSpan = null, this.colIndex = null, this.type = this.constructor.type, this.key = e;
	}
	get childNodes() {
		throw Error("childNodes is not supported");
	}
	clone() {
		let e = new this.constructor(this.key);
		return e.value = this.value, e.level = this.level, e.hasChildNodes = this.hasChildNodes, e.rendered = this.rendered, e.textValue = this.textValue, e["aria-label"] = this["aria-label"], e.index = this.index, e.parentKey = this.parentKey, e.prevKey = this.prevKey, e.nextKey = this.nextKey, e.firstChildKey = this.firstChildKey, e.lastChildKey = this.lastChildKey, e.props = this.props, e.render = this.render, e.colSpan = this.colSpan, e.colIndex = this.colIndex, e;
	}
	filter(e, t, n) {
		let r = this.clone();
		return t.addDescendants(r, e), r;
	}
}, Ss = class extends xs {
	filter(e, t, n) {
		let [r, i] = Os(e, t, this.firstChildKey, n), a = this.clone();
		return a.firstChildKey = r, a.lastChildKey = i, a;
	}
}, Cs = class extends xs {
	static {
		this.type = "header";
	}
}, ws = class extends xs {
	static {
		this.type = "loader";
	}
}, Ts = class extends Ss {
	static {
		this.type = "item";
	}
	filter(e, t, n) {
		if (n(this.textValue, this)) {
			let n = this.clone();
			return t.addDescendants(n, e), n;
		}
		return null;
	}
}, Es = class extends Ss {
	static {
		this.type = "section";
	}
	filter(e, t, n) {
		let r = super.filter(e, t, n);
		if (r && r.lastChildKey !== null) {
			let t = e.getItem(r.lastChildKey);
			if (t && t.type !== "header") return r;
		}
		return null;
	}
}, Ds = class {
	get size() {
		return this.itemCount;
	}
	getKeys() {
		return this.keyMap.keys();
	}
	*[Symbol.iterator]() {
		let e = this.firstKey == null ? void 0 : this.keyMap.get(this.firstKey);
		for (; e;) yield e, e = e.nextKey == null ? void 0 : this.keyMap.get(e.nextKey);
	}
	getChildren(e) {
		let t = this.keyMap;
		return { *[Symbol.iterator]() {
			let n = t.get(e), r = n?.firstChildKey == null ? null : t.get(n.firstChildKey);
			for (; r;) yield r, r = r.nextKey == null ? void 0 : t.get(r.nextKey);
		} };
	}
	getKeyBefore(e) {
		let t = this.keyMap.get(e);
		if (!t) return null;
		if (t.prevKey != null) {
			for (t = this.keyMap.get(t.prevKey); t && t.type !== "item" && t.lastChildKey != null;) t = this.keyMap.get(t.lastChildKey);
			return t?.key ?? null;
		}
		return t.parentKey;
	}
	getKeyAfter(e) {
		let t = this.keyMap.get(e);
		if (!t) return null;
		if (t.type !== "item" && t.firstChildKey != null) return t.firstChildKey;
		for (; t;) {
			if (t.nextKey != null) return t.nextKey;
			if (t.parentKey != null) t = this.keyMap.get(t.parentKey);
			else return null;
		}
		return null;
	}
	getFirstKey() {
		return this.firstKey;
	}
	getLastKey() {
		let e = this.lastKey == null ? null : this.keyMap.get(this.lastKey);
		for (; e?.lastChildKey != null;) e = this.keyMap.get(e.lastChildKey);
		return e?.key ?? null;
	}
	getItem(e) {
		return this.keyMap.get(e) ?? null;
	}
	at() {
		throw Error("Not implemented");
	}
	clone() {
		let e = this.constructor, t = new e();
		return t.keyMap = new Map(this.keyMap), t.firstKey = this.firstKey, t.lastKey = this.lastKey, t.itemCount = this.itemCount, t;
	}
	addNode(e) {
		if (this.frozen) throw Error("Cannot add a node to a frozen collection");
		e.type === "item" && this.keyMap.get(e.key) == null && this.itemCount++, this.keyMap.set(e.key, e);
	}
	addDescendants(e, t) {
		this.addNode(e);
		let n = t.getChildren(e.key);
		for (let e of n) this.addDescendants(e, t);
	}
	removeNode(e) {
		if (this.frozen) throw Error("Cannot remove a node to a frozen collection");
		let t = this.keyMap.get(e);
		t != null && t.type === "item" && this.itemCount--, this.keyMap.delete(e);
	}
	commit(e, t, n = !1) {
		if (this.frozen) throw Error("Cannot commit a frozen collection");
		this.firstKey = e, this.lastKey = t, this.frozen = !n;
	}
	filter(e) {
		let t = new this.constructor(), [n, r] = Os(this, t, this.firstKey, e);
		return t?.commit(n, r), t;
	}
	constructor() {
		this.keyMap = /* @__PURE__ */ new Map(), this.firstKey = null, this.lastKey = null, this.frozen = !1, this.itemCount = 0;
	}
};
function Os(e, t, n, r) {
	if (n == null) return [null, null];
	let i = null, a = null, o = e.getItem(n);
	for (; o != null;) {
		let n = o.filter(e, t, r);
		n != null && (n.nextKey = null, a && (n.prevKey = a.key, a.nextKey = n.key), i ??= n, t.addNode(n), a = n), o = o.nextKey == null ? null : e.getItem(o.nextKey);
	}
	if (a && a.type === "separator") {
		let e = a.prevKey;
		t.removeNode(a.key), e == null ? a = null : (a = t.getItem(e), a.nextKey = null);
	}
	return [i?.key ?? null, a?.key ?? null];
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/collections/Document.mjs
var ks = class {
	constructor(e) {
		this._firstChild = null, this._lastChild = null, this._previousSibling = null, this._nextSibling = null, this._parentNode = null, this._minInvalidChildIndex = null, this.ownerDocument = e;
	}
	*[Symbol.iterator]() {
		let e = this.firstChild;
		for (; e;) yield e, e = e.nextSibling;
	}
	get firstChild() {
		return this._firstChild;
	}
	set firstChild(e) {
		this._firstChild = e, this.ownerDocument.markDirty(this);
	}
	get lastChild() {
		return this._lastChild;
	}
	set lastChild(e) {
		this._lastChild = e, this.ownerDocument.markDirty(this);
	}
	get previousSibling() {
		return this._previousSibling;
	}
	set previousSibling(e) {
		this._previousSibling = e, this.ownerDocument.markDirty(this);
	}
	get nextSibling() {
		return this._nextSibling;
	}
	set nextSibling(e) {
		this._nextSibling = e, this.ownerDocument.markDirty(this);
	}
	get parentNode() {
		return this._parentNode;
	}
	set parentNode(e) {
		this._parentNode = e, this.ownerDocument.markDirty(this);
	}
	get isConnected() {
		return this.parentNode?.isConnected || !1;
	}
	invalidateChildIndices(e) {
		(this._minInvalidChildIndex == null || !this._minInvalidChildIndex.isConnected || e.index < this._minInvalidChildIndex.index) && (this._minInvalidChildIndex = e, this.ownerDocument.markDirty(this));
	}
	updateChildIndices() {
		let e = this._minInvalidChildIndex;
		for (; e;) e.index = e.previousSibling ? e.previousSibling.index + 1 : 0, e = e.nextSibling;
		this._minInvalidChildIndex = null;
	}
	appendChild(e) {
		e.parentNode && e.parentNode.removeChild(e), this.firstChild ??= e, this.lastChild ? (this.lastChild.nextSibling = e, e.index = this.lastChild.index + 1, e.previousSibling = this.lastChild) : (e.previousSibling = null, e.index = 0), e.parentNode = this, e.nextSibling = null, this.lastChild = e, this.ownerDocument.markDirty(this), this.isConnected && this.ownerDocument.queueUpdate();
	}
	insertBefore(e, t) {
		if (t == null) return this.appendChild(e);
		e.parentNode && e.parentNode.removeChild(e), e.nextSibling = t, e.previousSibling = t.previousSibling, e.index = t.index - 1, this.firstChild === t ? this.firstChild = e : t.previousSibling && (t.previousSibling.nextSibling = e), t.previousSibling = e, e.parentNode = t.parentNode, this.invalidateChildIndices(e), this.isConnected && this.ownerDocument.queueUpdate();
	}
	removeChild(e) {
		e.parentNode === this && (this._minInvalidChildIndex === e && (this._minInvalidChildIndex = null), e.nextSibling && (this.invalidateChildIndices(e.nextSibling), e.nextSibling.previousSibling = e.previousSibling), e.previousSibling && (e.previousSibling.nextSibling = e.nextSibling), this.firstChild === e && (this.firstChild = e.nextSibling), this.lastChild === e && (this.lastChild = e.previousSibling), e.parentNode = null, e.nextSibling = null, e.previousSibling = null, e.index = 0, this.ownerDocument.markDirty(e), this.isConnected && this.ownerDocument.queueUpdate());
	}
	addEventListener() {}
	removeEventListener() {}
	get previousVisibleSibling() {
		let e = this.previousSibling;
		for (; e && e.isHidden;) e = e.previousSibling;
		return e;
	}
	get nextVisibleSibling() {
		let e = this.nextSibling;
		for (; e && e.isHidden;) e = e.nextSibling;
		return e;
	}
	get firstVisibleChild() {
		let e = this.firstChild;
		for (; e && e.isHidden;) e = e.nextSibling;
		return e;
	}
	get lastVisibleChild() {
		let e = this.lastChild;
		for (; e && e.isHidden;) e = e.previousSibling;
		return e;
	}
}, As = class e extends ks {
	constructor(e, t) {
		super(t), this.nodeType = 8, this.isMutated = !0, this._index = 0, this.isHidden = !1, this.node = null;
	}
	get index() {
		return this._index;
	}
	set index(e) {
		this._index = e, this.ownerDocument.markDirty(this);
	}
	get level() {
		return this.parentNode instanceof e ? this.parentNode.level + +(this.parentNode.node?.type === "item") : 0;
	}
	getMutableNode() {
		return this.node == null ? null : (this.isMutated ||= (this.node = this.node.clone(), !0), this.ownerDocument.markDirty(this), this.node);
	}
	updateNode() {
		let t = this.nextVisibleSibling, n = this.getMutableNode();
		if (n != null && (n.index = this.index, n.level = this.level, n.parentKey = this.parentNode instanceof e ? this.parentNode.node?.key ?? null : null, n.prevKey = this.previousVisibleSibling?.node?.key ?? null, n.nextKey = t?.node?.key ?? null, n.hasChildNodes = !!this.firstChild, n.firstChildKey = this.firstVisibleChild?.node?.key ?? null, n.lastChildKey = this.lastVisibleChild?.node?.key ?? null, (n.colSpan != null || n.colIndex != null) && t)) {
			let e = (n.colIndex ?? n.index) + (n.colSpan ?? 1);
			if (t.node != null && e !== t.node.colIndex) {
				let n = t.getMutableNode();
				n.colIndex = e;
			}
		}
	}
	setProps(e, t, n, r, i) {
		let a, { value: o, textValue: s, id: c, ...l } = e;
		if (this.node == null ? (a = new n(c ?? `react-aria-${++this.ownerDocument.nodeId}`), this.node = a) : a = this.getMutableNode(), l.ref = t, a.props = l, a.rendered = r, a.render = i, a.value = o, e["aria-label"] && (a["aria-label"] = e["aria-label"]), a.textValue = s || (typeof l.children == "string" ? l.children : "") || e["aria-label"] || "", c != null && c !== a.key) throw Error("Cannot change the id of an item");
		l.colSpan != null && (a.colSpan = l.colSpan), this.isConnected && this.ownerDocument.queueUpdate();
	}
	get style() {
		let e = this;
		return {
			get display() {
				return e.isHidden ? "none" : "";
			},
			set display(t) {
				let n = t === "none";
				if (e.isHidden !== n) {
					(e.parentNode?.firstVisibleChild === e || e.parentNode?.lastVisibleChild === e) && e.ownerDocument.markDirty(e.parentNode);
					let t = e.previousVisibleSibling, r = e.nextVisibleSibling;
					t && e.ownerDocument.markDirty(t), r && e.ownerDocument.markDirty(r), e.isHidden = n, e.ownerDocument.markDirty(e);
				}
			}
		};
	}
	hasAttribute() {}
	setAttribute() {}
	setAttributeNS() {}
	removeAttribute() {}
}, js = class extends ks {
	constructor(e) {
		super(null), this.nodeType = 11, this.ownerDocument = this, this.dirtyNodes = /* @__PURE__ */ new Set(), this.isSSR = !1, this.nodeId = 0, this.nodesByProps = /* @__PURE__ */ new WeakMap(), this.nextCollection = null, this.subscriptions = /* @__PURE__ */ new Set(), this.queuedRender = !1, this.inSubscription = !1, this.collection = e, this.nextCollection = e;
	}
	get isConnected() {
		return !0;
	}
	createElement(e) {
		return new As(e, this);
	}
	getMutableCollection() {
		return this.nextCollection ||= this.collection.clone(), this.nextCollection;
	}
	markDirty(e) {
		this.dirtyNodes.add(e);
	}
	addNode(e) {
		if (e.isHidden || e.node == null) return;
		let t = this.getMutableCollection();
		if (!t.getItem(e.node.key)) for (let t of e) this.addNode(t);
		t.addNode(e.node);
	}
	removeNode(e) {
		for (let t of e) this.removeNode(t);
		e.node && this.getMutableCollection().removeNode(e.node.key);
	}
	getCollection() {
		return this.inSubscription ? this.collection : (this.queuedRender = !1, this.updateCollection(), this.collection);
	}
	updateCollection() {
		for (let e of this.dirtyNodes) e instanceof As && (!e.isConnected || e.isHidden) ? this.removeNode(e) : e.updateChildIndices();
		for (let e of this.dirtyNodes) e instanceof As ? (e.isConnected && !e.isHidden && (e.updateNode(), this.addNode(e)), e.node && this.dirtyNodes.delete(e), e.isMutated = !1) : this.dirtyNodes.delete(e);
		this.nextCollection && (this.nextCollection.commit(this.firstVisibleChild?.node?.key ?? null, this.lastVisibleChild?.node?.key ?? null, this.isSSR), this.isSSR || (this.collection = this.nextCollection, this.nextCollection = null));
	}
	queueUpdate() {
		if (!(this.dirtyNodes.size === 0 || this.queuedRender)) {
			this.queuedRender = !0, this.inSubscription = !0, this.isSSR || (this.collection = this.collection.clone());
			for (let e of this.subscriptions) e();
			this.inSubscription = !1;
		}
	}
	subscribe(e) {
		return this.subscriptions.add(e), this.queuedRender && e(), () => this.subscriptions.delete(e);
	}
	resetAfterSSR() {
		this.isSSR && (this.isSSR = !1, this.firstChild = null, this.lastChild = null, this.nodeId = 0);
	}
};
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/collections/useCachedChildren.mjs
function Ms(e) {
	let { children: t, items: n, idScope: r, addIdAndValue: i, dependencies: a = [] } = e, o = (0, _.useMemo)(() => void 0, [t]), s = (0, _.useMemo)(() => /* @__PURE__ */ new WeakMap(), [...a, o]);
	return (0, _.useMemo)(() => {
		if (n && typeof t == "function") {
			let e = [];
			for (let a of n) {
				let n = Ns(a) ? a : null, o = n ? s.get(n) : null;
				if (!o) {
					o = t(a);
					let c = o.props.id ?? a?.key ?? a?.id;
					r != null && o.props.id == null && c != null && (c = r + ":" + c);
					let l = c ?? e.length;
					o = (0, _.cloneElement)(o, i ? {
						key: l,
						id: c,
						value: a
					} : { key: l }), n && s.set(n, o);
				}
				e.push(o);
			}
			return e;
		}
		if (typeof t != "function") return t;
	}, [
		t,
		n,
		s,
		r,
		i
	]);
}
function Ns(e) {
	switch (typeof e) {
		case "object": return e != null;
		case "function":
		case "symbol": return !0;
		default: return !1;
	}
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.production.js
var Ps = /* @__PURE__ */ o(((e) => {
	var t = u();
	function n(e, t) {
		return e === t && (e !== 0 || 1 / e == 1 / t) || e !== e && t !== t;
	}
	var r = typeof Object.is == "function" ? Object.is : n, i = t.useState, a = t.useEffect, o = t.useLayoutEffect, s = t.useDebugValue;
	function c(e, t) {
		var n = t(), r = i({ inst: {
			value: n,
			getSnapshot: t
		} }), c = r[0].inst, u = r[1];
		return o(function() {
			c.value = n, c.getSnapshot = t, l(c) && u({ inst: c });
		}, [
			e,
			n,
			t
		]), a(function() {
			return l(c) && u({ inst: c }), e(function() {
				l(c) && u({ inst: c });
			});
		}, [e]), s(n), n;
	}
	function l(e) {
		var t = e.getSnapshot;
		e = e.value;
		try {
			var n = t();
			return !r(e, n);
		} catch {
			return !0;
		}
	}
	function d(e, t) {
		return t();
	}
	var f = typeof window > "u" || window.document === void 0 || window.document.createElement === void 0 ? d : c;
	e.useSyncExternalStore = t.useSyncExternalStore === void 0 ? f : t.useSyncExternalStore;
})), Fs = (/* @__PURE__ */ o(((e, t) => {
	t.exports = Ps();
})))(), Is = /*#__PURE__*/ (0, _.createContext)(!1), Ls = /*#__PURE__*/ (0, _.createContext)(null);
function Rs(e) {
	if ((0, _.useContext)(Ls)) return e.content;
	let { collection: t, document: n } = Hs(e.createCollection);
	return /*#__PURE__*/ _.createElement(_.Fragment, null, /*#__PURE__*/ _.createElement(gi, null, /*#__PURE__*/ _.createElement(Ls.Provider, { value: n }, e.content)), /*#__PURE__*/ _.createElement(zs, {
		render: e.children,
		collection: t
	}));
}
function zs({ collection: e, render: t }) {
	return t(e);
}
function Bs(e, t, n) {
	let r = Gr(), i = (0, _.useRef)(r);
	i.current = r;
	let a = (0, _.useCallback)(() => i.current ? n() : t(), [t, n]);
	return (0, Fs.useSyncExternalStore)(e, a);
}
var Vs = typeof _.useSyncExternalStore == "function" ? _.useSyncExternalStore : Bs;
function Hs(e) {
	let [t] = (0, _.useState)(() => new js(e?.() || new Ds()));
	return {
		collection: Vs((0, _.useCallback)((e) => t.subscribe(e), [t]), (0, _.useCallback)(() => {
			let e = t.getCollection();
			return t.isSSR && t.resetAfterSSR(), e;
		}, [t]), (0, _.useCallback)(() => (t.isSSR = !0, t.getCollection()), [t])),
		document: t
	};
}
var Us = /*#__PURE__*/ (0, _.createContext)(null);
function Ws(e) {
	return class extends xs {
		static {
			this.type = e;
		}
	};
}
function Gs(e, t, n, r, i, a) {
	typeof e == "string" && (e = Ws(e));
	let o = (0, _.useCallback)((i) => {
		i?.setProps(t, n, e, r, a);
	}, [
		t,
		n,
		r,
		a,
		e
	]), s = (0, _.useContext)(Us);
	if (s) {
		let o = s.ownerDocument.nodesByProps.get(t);
		return o || (o = s.ownerDocument.createElement(e.type), o.setProps(t, n, e, r, a), s.appendChild(o), s.ownerDocument.updateCollection(), s.ownerDocument.nodesByProps.set(t, o)), i ? /*#__PURE__*/ _.createElement(Us.Provider, { value: o }, i) : null;
	}
	return /*#__PURE__*/ _.createElement(e.type, { ref: o }, i);
}
function Ks(e, t) {
	let n = ({ node: e }) => t(e.props, e.props.ref, e), r = (0, _.forwardRef)((r, i) => {
		let a = (0, _.useContext)(Po);
		if (!(0, _.useContext)(Is)) {
			if (t.length >= 3) throw Error(t.name + " cannot be rendered outside a collection.");
			return t(r, i);
		}
		return Gs(e, r, i, "children" in r ? r.children : null, null, (e) => /*#__PURE__*/ _.createElement(Po.Provider, { value: a }, /*#__PURE__*/ _.createElement(n, { node: e })));
	});
	return r.displayName = t.name, r;
}
function qs(e, t, n = Js) {
	let r = ({ node: e }) => t(e.props, e.props.ref, e), i = (0, _.forwardRef)((t, i) => Gs(e, t, i, null, n(t), (e) => /*#__PURE__*/ _.createElement(r, { node: e })) ?? /*#__PURE__*/ _.createElement(_.Fragment, null));
	return i.displayName = t.name, i;
}
function Js(e) {
	return Ms({
		...e,
		addIdAndValue: !0
	});
}
var Ys = /*#__PURE__*/ (0, _.createContext)(null);
function Xs(e) {
	let t = (0, _.useContext)(Ys), n = (t?.dependencies || []).concat(e.dependencies), r = e.idScope ?? t?.idScope, i = Js({
		...e,
		idScope: r,
		dependencies: n
	});
	return (0, _.useContext)(Ls) && (i = /*#__PURE__*/ _.createElement(Zs, null, i)), t = (0, _.useMemo)(() => ({
		dependencies: n,
		idScope: r
	}), [r, ...n]), /*#__PURE__*/ _.createElement(Ys.Provider, { value: t }, i);
}
function Zs({ children: e }) {
	let t = (0, _.useContext)(Ls), n = (0, _.useMemo)(() => /*#__PURE__*/ _.createElement(Ls.Provider, { value: null }, /*#__PURE__*/ _.createElement(Is.Provider, { value: !0 }, e)), [e]);
	return Gr() ? /*#__PURE__*/ _.createElement(Us.Provider, { value: t }, n) : /*#__PURE__*/ (0, Jo.createPortal)(n, t);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria-components/dist/private/Collection.mjs
var Qs = /*#__PURE__*/ (0, _.createContext)(null), $s = {
	CollectionRoot({ collection: e, renderDropIndicator: t }) {
		return ec(e, null, t);
	},
	CollectionBranch({ collection: e, parent: t, renderDropIndicator: n }) {
		return ec(e, t, n);
	}
};
function ec(e, t, n) {
	return Ms({
		items: t ? e.getChildren(t.key) : e,
		dependencies: [n],
		children(t) {
			if (t.type === "content") return /*#__PURE__*/ _.createElement(_.Fragment, null);
			let r = t.render(t);
			return !n || t.type !== "item" ? r : /*#__PURE__*/ _.createElement(_.Fragment, null, n({
				type: "item",
				key: t.key,
				dropPosition: "before"
			}), r, tc(e, t, n));
		}
	});
}
function tc(e, t, n) {
	let r = t.key, i = e.getKeyAfter(r), a = i == null ? null : e.getItem(i);
	for (; a != null && a.type !== "item";) i = e.getKeyAfter(a.key), a = i == null ? null : e.getItem(i);
	let o = t.nextKey == null ? null : e.getItem(t.nextKey);
	for (; o != null && o.type !== "item";) o = o.nextKey == null ? null : e.getItem(o.nextKey);
	let s = [];
	if (o == null) {
		let r = t;
		for (; r?.type === "item" && (!a || r.parentKey !== a.parentKey && a.level < r.level);) {
			let t = n({
				type: "item",
				key: r.key,
				dropPosition: "after"
			});
			/*#__PURE__*/ (0, _.isValidElement)(t) && s.push(/*#__PURE__*/ (0, _.cloneElement)(t, { key: `${r.key}-after` })), r = r.parentKey == null ? null : e.getItem(r.parentKey);
		}
	}
	return s;
}
var nc = /*#__PURE__*/ (0, _.createContext)($s);
function rc(e) {
	return (0, _.useMemo)(() => e == null ? null : /* @__PURE__ */ new Set([e]), [e]);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/constants.mjs
var ic = "react-aria-clear-focus", ac = "react-aria-focus";
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/focus/virtualFocus.mjs
function oc(e) {
	let t = lc(N(e));
	t !== e && (t && sc(t, e), e && cc(e, t));
}
function sc(e, t) {
	e.dispatchEvent(new FocusEvent("blur", { relatedTarget: t })), e.dispatchEvent(new FocusEvent("focusout", {
		bubbles: !0,
		relatedTarget: t
	}));
}
function cc(e, t) {
	e.dispatchEvent(new FocusEvent("focus", { relatedTarget: t })), e.dispatchEvent(new FocusEvent("focusin", {
		bubbles: !0,
		relatedTarget: t
	}));
}
function lc(e) {
	let t = ia(e), n = t?.getAttribute("aria-activedescendant");
	return n && e.getElementById(n) || t;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/keyboard.mjs
function uc(e) {
	return wa() ? e.metaKey : e.ctrlKey;
}
var dc = /* @__PURE__ */ new Set([
	"checkbox",
	"radio",
	"range",
	"color",
	"file",
	"image",
	"button",
	"submit",
	"reset"
]);
function fc(e) {
	return e instanceof HTMLInputElement && !dc.has(e.type) || e instanceof HTMLTextAreaElement || e instanceof HTMLElement && e.isContentEditable;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useEvent.mjs
function pc(e, t, n, r) {
	let i = L(n), a = n == null;
	(0, _.useEffect)(() => {
		if (!(a || e.current == null)) return ea(e.current, t, i, r);
	}, [
		e,
		t,
		r,
		a
	]);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/@internationalized/string/dist/private/LocalizedStringDictionary.mjs
var mc = Symbol.for("react-aria.i18n.locale"), hc = Symbol.for("react-aria.i18n.strings"), gc = void 0, _c = class e {
	constructor(e, t = "en-US") {
		this.strings = Object.fromEntries(Object.entries(e).filter(([, e]) => e)), this.defaultLocale = t;
	}
	getStringForLocale(e, t) {
		let n = this.getStringsForLocale(t)[e];
		if (!n) throw Error(`Could not find intl message ${e} in ${t} locale`);
		return n;
	}
	getStringsForLocale(e) {
		let t = this.strings[e];
		return t || (t = vc(e, this.strings, this.defaultLocale), this.strings[e] = t), t;
	}
	static getGlobalDictionaryForPackage(t) {
		if (typeof window > "u") return null;
		let n = window[mc];
		if (gc === void 0) {
			let t = window[hc];
			if (!t) return null;
			gc = {};
			for (let r in t) gc[r] = new e({ [n]: t[r] }, n);
		}
		let r = gc?.[t];
		if (!r) throw Error(`Strings for package "${t}" were not included by LocalizedStringProvider. Please add it to the list passed to createLocalizedStringDictionary.`);
		return r;
	}
};
function vc(e, t, n = "en-US") {
	if (t[e]) return t[e];
	let r = yc(e), i = bc(e);
	if (i && t[`${r}-${i}`]) return t[`${r}-${i}`];
	if (t[r]) return t[r];
	for (let e in t) if (e.startsWith(r + "-")) return t[e];
	return t[n];
}
function yc(e) {
	return Intl.Locale ? new Intl.Locale(e).language : e.split("-")[0];
}
function bc(e) {
	if (Intl.Locale) return new Intl.Locale(e).script;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/@internationalized/string/dist/private/LocalizedStringFormatter.mjs
var xc = /* @__PURE__ */ new Map(), Sc = /* @__PURE__ */ new Map(), Cc = class {
	constructor(e, t) {
		this.locale = e, this.strings = t;
	}
	format(e, t) {
		let n = this.strings.getStringForLocale(e, this.locale);
		return typeof n == "function" ? n(t, this) : n;
	}
	plural(e, t, n = "cardinal") {
		let r = t["=" + e];
		if (r) return typeof r == "function" ? r() : r;
		let i = this.locale + ":" + n, a = xc.get(i);
		return a || (a = new Intl.PluralRules(this.locale, { type: n }), xc.set(i, a)), r = t[a.select(e)] || t.other, typeof r == "function" ? r() : r;
	}
	number(e) {
		let t = Sc.get(this.locale);
		return t || (t = new Intl.NumberFormat(this.locale), Sc.set(this.locale, t)), t.format(e);
	}
	select(e, t) {
		let n = e[t] || e.other;
		return typeof n == "function" ? n() : n;
	}
}, wc = /* @__PURE__ */ new WeakMap();
function Tc(e) {
	let t = wc.get(e);
	return t || (t = new _c(e), wc.set(e, t)), t;
}
function Ec(e, t) {
	return t && _c.getGlobalDictionaryForPackage(t) || Tc(e);
}
function Dc(e, t) {
	let { locale: n } = Li(), r = Ec(e, t);
	return (0, _.useMemo)(() => new Cc(n, r), [n, r]);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/utils/useControlledState.mjs
var Oc = typeof document < "u" ? _.useInsertionEffect ?? _.useLayoutEffect : () => {};
function kc(e, t, n) {
	let [r, i] = (0, _.useState)(e || t), a = (0, _.useRef)(r), o = (0, _.useRef)(e !== void 0), s = e !== void 0;
	(0, _.useEffect)(() => {
		o.current, o.current = s;
	}, [s]);
	let c = s ? e : r;
	Oc(() => {
		a.current = c;
	});
	let [, l] = (0, _.useReducer)(() => ({}), {});
	return [c, (0, _.useCallback)((e, ...t) => {
		let r = typeof e == "function" ? e(a.current) : e;
		Object.is(a.current, r) || (a.current = r, i(r), l(), n?.(r, ...t));
	}, [n])];
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria-components/dist/private/Autocomplete.mjs
var Ac = /*#__PURE__*/ (0, _.createContext)(null), jc = /*#__PURE__*/ (0, _.createContext)(null), Mc = /*#__PURE__*/ (0, _.createContext)({}), Nc = /*#__PURE__*/ Ks(Cs, function(e, t) {
	return [e, t] = ui(e, t, Mc), /*#__PURE__*/ _.createElement(mi.header, {
		className: "react-aria-Header",
		...e,
		ref: t
	}, e.children);
}), Pc = /*#__PURE__*/ (0, _.createContext)({}), Fc = /*#__PURE__*/ (0, _.createContext)({ placement: "bottom" }), Ic = class {
	constructor(e, t, n, r) {
		this._walkerStack = [], this._currentSetFor = /* @__PURE__ */ new Set(), this._acceptNode = (e) => {
			if (e.nodeType === Node.ELEMENT_NODE) {
				let t = e.shadowRoot;
				if (t) {
					let e = this._doc.createTreeWalker(t, this.whatToShow, { acceptNode: this._acceptNode });
					return this._walkerStack.unshift(e), NodeFilter.FILTER_ACCEPT;
				}
				if (typeof this.filter == "function") return this.filter(e);
				if (this.filter?.acceptNode) return this.filter.acceptNode(e);
				if (this.filter === null) return NodeFilter.FILTER_ACCEPT;
			}
			return NodeFilter.FILTER_SKIP;
		}, this._doc = e, this.root = t, this.filter = r ?? null, this.whatToShow = n ?? NodeFilter.SHOW_ALL, this._currentNode = t, this._walkerStack.unshift(e.createTreeWalker(t, n, this._acceptNode));
		let i = t.shadowRoot;
		if (i) {
			let e = this._doc.createTreeWalker(i, this.whatToShow, { acceptNode: this._acceptNode });
			this._walkerStack.unshift(e);
		}
	}
	get currentNode() {
		return this._currentNode;
	}
	set currentNode(e) {
		if (!P(this.root, e)) throw Error("Cannot set currentNode to a node that is not contained by the root node.");
		let t = [], n = e, r = e;
		for (this._currentNode = e; n && n !== this.root;) if (n.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
			let e = n, i = this._doc.createTreeWalker(e, this.whatToShow, { acceptNode: this._acceptNode });
			t.push(i), i.currentNode = r, this._currentSetFor.add(i), n = r = e.host;
		} else n = n.parentNode;
		let i = this._doc.createTreeWalker(this.root, this.whatToShow, { acceptNode: this._acceptNode });
		t.push(i), i.currentNode = r, this._currentSetFor.add(i), this._walkerStack = t;
	}
	get doc() {
		return this._doc;
	}
	firstChild() {
		let e = this.currentNode, t = this.nextNode();
		return P(e, t) ? (t && (this.currentNode = t), t) : (this.currentNode = e, null);
	}
	lastChild() {
		let e = this._walkerStack[0].lastChild();
		return e && (this.currentNode = e), e;
	}
	nextNode() {
		let e = this._walkerStack[0].nextNode();
		if (e) {
			if (e.shadowRoot) {
				let t;
				if (typeof this.filter == "function" ? t = this.filter(e) : this.filter?.acceptNode && (t = this.filter.acceptNode(e)), t === NodeFilter.FILTER_ACCEPT) return this.currentNode = e, e;
				let n = this.nextNode();
				return n && (this.currentNode = n), n;
			}
			return e && (this.currentNode = e), e;
		}
		if (this._walkerStack.length > 1) {
			this._walkerStack.shift();
			let e = this.nextNode();
			return e && (this.currentNode = e), e;
		}
		return null;
	}
	previousNode() {
		let e = this._walkerStack[0];
		if (e.currentNode === e.root) {
			if (this._currentSetFor.has(e)) {
				if (this._currentSetFor.delete(e), this._walkerStack.length > 1) {
					this._walkerStack.shift();
					let e = this.previousNode();
					return e && (this.currentNode = e), e;
				}
				return null;
			}
			return null;
		}
		let t = e.previousNode();
		if (t) {
			if (t.shadowRoot) {
				let e;
				if (typeof this.filter == "function" ? e = this.filter(t) : this.filter?.acceptNode && (e = this.filter.acceptNode(t)), e === NodeFilter.FILTER_ACCEPT) return t && (this.currentNode = t), t;
				let n = this.lastChild();
				return n && (this.currentNode = n), n;
			}
			return t && (this.currentNode = t), t;
		}
		if (this._walkerStack.length > 1) {
			this._walkerStack.shift();
			let e = this.previousNode();
			return e && (this.currentNode = e), e;
		}
		return null;
	}
	nextSibling() {
		return null;
	}
	previousSibling() {
		return null;
	}
	parentNode() {
		return null;
	}
};
function Lc(e, t, n, r) {
	return ra() ? new Ic(e, t, n, r) : e.createTreeWalker(t, n, r);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/ariaHideOutside.mjs
var Rc = typeof HTMLElement < "u" && "inert" in HTMLElement.prototype;
function zc(e) {
	return e.dataset.liveAnnouncer === "true" || e.dataset.reactAriaTopLayer !== void 0;
}
var Bc = /* @__PURE__ */ new WeakMap(), Vc = [];
function Hc(e, t) {
	let n = Yi(e?.[0]), r = t instanceof n.Element ? { root: t } : t, i = r?.root ?? document.body, a = r?.shouldUseInert && Rc, o = new Set(e), s = /* @__PURE__ */ new Set(), c = (e) => a && e instanceof n.HTMLElement ? e.inert : e.getAttribute("aria-hidden") === "true", l = (e, t) => {
		a && e instanceof n.HTMLElement ? e.inert = t : t ? e.setAttribute("aria-hidden", "true") : (e.removeAttribute("aria-hidden"), e instanceof n.HTMLElement && (e.inert = !1));
	}, u = /* @__PURE__ */ new Set();
	if (ra()) {
		let t = i.getRootNode();
		for (let n of e) {
			let e = n.getRootNode();
			for (; $i(e) && e !== t;) u.add(e), e = e.host.getRootNode();
		}
	}
	let d = (e) => {
		for (let t of e.querySelectorAll("[data-live-announcer], [data-react-aria-top-layer]")) o.add(t);
		let t = (e) => {
			if (s.has(e) || o.has(e) || e.parentElement && s.has(e.parentElement) && e.parentElement.getAttribute("role") !== "row") return NodeFilter.FILTER_REJECT;
			for (let t of o) if (P(e, t)) return NodeFilter.FILTER_SKIP;
			return NodeFilter.FILTER_ACCEPT;
		}, n = Lc(N(e), e, NodeFilter.SHOW_ELEMENT, { acceptNode: t }), r = t(e);
		if (r === NodeFilter.FILTER_ACCEPT && f(e), r !== NodeFilter.FILTER_REJECT) {
			let e = n.nextNode();
			for (; e != null;) f(e), e = n.nextNode();
		}
	}, f = (e) => {
		let t = Bc.get(e) ?? 0;
		c(e) && t === 0 || (t === 0 && l(e, !0), s.add(e), Bc.set(e, t + 1));
	};
	Vc.length && Vc[Vc.length - 1].disconnect(), d(i);
	let p = new MutationObserver((e) => {
		for (let t of e) if (t.type === "childList") {
			if (t.target.isConnected && ![...o, ...s].some((e) => P(e, t.target))) for (let e of t.addedNodes) (e instanceof HTMLElement || e instanceof SVGElement) && zc(e) ? o.add(e) : e instanceof Element && d(e);
			if (ra()) {
				for (let e of u) if (!e.isConnected) {
					p.disconnect();
					break;
				}
			}
		}
	});
	p.observe(i, {
		childList: !0,
		subtree: !0
	});
	let m = /* @__PURE__ */ new Set();
	if (ra()) for (let e of u) {
		let t = new MutationObserver((e) => {
			for (let t of e) if (t.type === "childList") {
				if (t.target.isConnected && ![...o, ...s].some((e) => P(e, t.target))) for (let e of t.addedNodes) (e instanceof HTMLElement || e instanceof SVGElement) && zc(e) ? o.add(e) : e instanceof Element && d(e);
				if (ra()) {
					for (let e of u) if (!e.isConnected) {
						p.disconnect();
						break;
					}
				}
			}
		});
		t.observe(e, {
			childList: !0,
			subtree: !0
		}), m.add(t);
	}
	let h = {
		visibleNodes: o,
		hiddenNodes: s,
		observe() {
			p.observe(i, {
				childList: !0,
				subtree: !0
			});
		},
		disconnect() {
			p.disconnect();
		}
	};
	return Vc.push(h), () => {
		if (p.disconnect(), ra()) for (let e of m) e.disconnect();
		for (let e of s) {
			let t = Bc.get(e);
			t != null && (t === 1 ? (l(e, !1), Bc.delete(e)) : Bc.set(e, t - 1));
		}
		h === Vc[Vc.length - 1] ? (Vc.pop(), Vc.length && Vc[Vc.length - 1].observe()) : Vc.splice(Vc.indexOf(h), 1);
	};
}
function Uc(e) {
	let t = Vc[Vc.length - 1];
	if (t && !t.visibleNodes.has(e)) return t.visibleNodes.add(e), () => {
		t.visibleNodes.delete(e);
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/calculatePosition.mjs
var Wc = {
	top: "top",
	bottom: "top",
	left: "left",
	right: "left"
}, Gc = {
	top: "bottom",
	bottom: "top",
	left: "right",
	right: "left"
}, Kc = {
	top: "left",
	left: "top"
}, qc = {
	top: "height",
	left: "width"
}, Jc = {
	width: "totalWidth",
	height: "totalHeight"
}, Yc = {}, Xc = () => typeof document < "u" ? window.visualViewport : null;
function Zc(e, t) {
	let n = 0, r = 0, i = 0, a = 0, o = 0, s = 0, c = {}, l = (t?.scale ?? 1) > 1;
	if (e.tagName === "BODY" || e.tagName === "HTML") {
		let l = document.documentElement;
		i = l.clientWidth, a = l.clientHeight, n = t?.width ?? i, r = t?.height ?? a, c.top = l.scrollTop || e.scrollTop, c.left = l.scrollLeft || e.scrollLeft, t && (o = Math.max(0, t.pageTop - (c.top ?? 0)), s = Math.max(0, t.pageLeft - (c.left ?? 0)));
	} else ({width: n, height: r, top: o, left: s} = cl(e, !1)), c.top = e.scrollTop, c.left = e.scrollLeft, i = n, a = r;
	return ka() && (e.tagName === "BODY" || e.tagName === "HTML") && l && (c.top = 0, c.left = 0, o = t?.pageTop ?? 0, s = t?.pageLeft ?? 0), {
		width: n,
		height: r,
		totalWidth: i,
		totalHeight: a,
		scroll: c,
		top: o,
		left: s
	};
}
function Qc(e) {
	return {
		top: e.scrollTop,
		left: e.scrollLeft,
		width: e.scrollWidth,
		height: e.scrollHeight
	};
}
function $c(e, t, n, r, i, a, o) {
	let s = i.scroll[e] ?? 0, c = r[qc[e]], l = o[e] + r.scroll[Wc[e]] + a, u = o[e] + r.scroll[Wc[e]] + c - a, d = t - s + r.scroll[Wc[e]] + o[e] - r[Wc[e]], f = t - s + n + r.scroll[Wc[e]] + o[e] - r[Wc[e]];
	return d < l ? l - d : f > u ? Math.max(u - f, l - d) : 0;
}
function el(e) {
	let t = window.getComputedStyle(e);
	return {
		top: parseInt(t.marginTop, 10) || 0,
		bottom: parseInt(t.marginBottom, 10) || 0,
		left: parseInt(t.marginLeft, 10) || 0,
		right: parseInt(t.marginRight, 10) || 0
	};
}
function tl(e) {
	if (Yc[e]) return Yc[e];
	let [t, n] = e.split(" "), r = Wc[t] || "right", i = Kc[r];
	Wc[n] || (n = "center");
	let a = qc[r], o = qc[i];
	return Yc[e] = {
		placement: t,
		crossPlacement: n,
		axis: r,
		crossAxis: i,
		size: a,
		crossSize: o
	}, Yc[e];
}
function nl(e, t, n, r, i, a, o, s, c, l, u) {
	let { placement: d, crossPlacement: f, axis: p, crossAxis: m, size: h, crossSize: g } = r, _ = {};
	_[m] = e[m] ?? 0, f === "center" ? _[m] += ((e[g] ?? 0) - (n[g] ?? 0)) / 2 : f !== m && (_[m] += (e[g] ?? 0) - (n[g] ?? 0)), _[m] += a;
	let v = e[m] - n[g] + c + l, y = e[m] + e[g] - c - l;
	if (_[m] = Ri(_[m], v, y), d === p) {
		let t = s ? u[h] : u[Jc[h]];
		_[Gc[p]] = Math.floor(t - e[p] + i);
	} else _[p] = Math.floor(e[p] + e[h] + i);
	return _;
}
function rl(e, t, n, r, i, a, o, s, c, l, u) {
	let d = (e.top == null ? c[Jc.height] - (e.bottom ?? 0) - o : e.top) - (c.scroll.top ?? 0), f = l ? n.top : 0, p = {
		top: Math.max(t.top + f, (u?.offsetTop ?? t.top) + f),
		bottom: Math.min(t.top + t.height + f, (u?.offsetTop ?? 0) + (u?.height ?? 0))
	};
	return s === "top" ? Math.max(0, d + o - p.top - ((i.top ?? 0) + (i.bottom ?? 0) + a)) : Math.max(0, p.bottom - d - ((i.top ?? 0) + (i.bottom ?? 0) + a));
}
function il(e, t, n, r, i, a, o, s) {
	let { placement: c, axis: l, size: u } = a;
	return c === l ? Math.max(0, n[l] - (o.scroll[l] ?? 0) - (e[l] + (s ? t[l] : 0)) - (r[l] ?? 0) - r[Gc[l]] - i) : Math.max(0, e[u] + e[l] + (s ? t[l] : 0) - n[l] - n[u] + (o.scroll[l] ?? 0) - (r[l] ?? 0) - r[Gc[l]] - i);
}
function al(e, t, n, r, i, a, o, s, c, l, u, d, f, p, m, h, g, _) {
	let v = tl(e), { size: y, crossAxis: b, crossSize: x, placement: S, crossPlacement: C } = v, w = nl(t, s, n, v, u, d, l, f, m, h, c), T = u, ee = il(s, l, t, i, a + u, v, c, g);
	if (o && n[y] > ee) {
		let e = tl(`${Gc[S]} ${C}`), r = nl(t, s, n, e, u, d, l, f, m, h, c);
		il(s, l, t, i, a + u, e, c, g) > ee && (v = e, w = r, T = u);
	}
	let E = "bottom";
	v.axis === "top" ? v.placement === "top" ? E = "top" : v.placement === "bottom" && (E = "bottom") : v.crossAxis === "top" && (v.crossPlacement === "top" ? E = "bottom" : v.crossPlacement === "bottom" && (E = "top"));
	let te = $c(b, w[b], n[x], s, c, a, l);
	w[b] += te;
	let D = rl(w, s, l, f, i, a, n.height, E, c, g, _);
	p && p < D && (D = p), n.height = Math.min(n.height, D), w = nl(t, s, n, v, T, d, l, f, m, h, c), te = $c(b, w[b], n[x], s, c, a, l), w[b] += te;
	let O = {}, ne = t[b] - w[b] - i[Wc[b]], re = ne + .5 * t[x], ie = m / 2 + h, ae = Wc[b] === "left" ? (i.left ?? 0) + (i.right ?? 0) : (i.top ?? 0) + (i.bottom ?? 0), oe = n[x] - ae - m / 2 - h;
	O[b] = Ri(Ri(re, t[b] + m / 2 - (w[b] + i[Wc[b]]), t[b] + t[x] - m / 2 - (w[b] + i[Wc[b]])), ie, oe), {placement: S, crossPlacement: C} = v, m ? ne = O[b] : C === "right" ? ne += t[x] : C === "center" && (ne += t[x] / 2);
	let se = S === "left" || S === "top" ? n[y] : 0, ce = {
		x: S === "top" || S === "bottom" ? ne : se,
		y: S === "left" || S === "right" ? ne : se
	};
	return {
		position: w,
		maxHeight: D,
		arrowOffsetLeft: O.left,
		arrowOffsetTop: O.top,
		placement: S,
		triggerAnchorPoint: ce
	};
}
function ol(e) {
	let { placement: t, targetNode: n, overlayNode: r, scrollNode: i, padding: a, shouldFlip: o, boundaryElement: s, offset: c, crossOffset: l, maxHeight: u, arrowSize: d = 0, arrowBoundaryOffset: f = 0, targetRect: p } = e, m = Xc(), h = r instanceof HTMLElement ? ul(r) : document.documentElement, g = h === document.documentElement, _ = window.getComputedStyle(h).position, v = !!_ && _ !== "static", y = g ? cl(n, !1, p) : ll(n, h, !1, p);
	if (!g) {
		let { marginTop: e, marginLeft: t } = window.getComputedStyle(n);
		y.top += parseInt(e, 10) || 0, y.left += parseInt(t, 10) || 0;
	}
	let b = cl(r, !0), x = el(r);
	b.width += (x.left ?? 0) + (x.right ?? 0), b.height += (x.top ?? 0) + (x.bottom ?? 0);
	let S = Qc(i), C = Zc(s, m), w = Zc(h, m), T;
	if ((s.tagName === "BODY" || s.tagName === "HTML") && !g) {
		let e = sl(h, !1);
		T = {
			top: -(e.top - C.top),
			left: -(e.left - C.left),
			width: 0,
			height: 0
		};
	} else T = (s.tagName === "BODY" || s.tagName === "HTML") && g ? {
		top: 0,
		left: 0,
		width: 0,
		height: 0
	} : ll(s, h, !1);
	let ee = P(s, h);
	return al(t, y, b, S, x, a, o, C, w, T, c, l, v, u, d, f, ee, m);
}
function sl(e, t) {
	let { top: n, left: r, width: i, height: a } = e.getBoundingClientRect();
	return t && e instanceof e.ownerDocument.defaultView.HTMLElement && (i = e.offsetWidth, a = e.offsetHeight), {
		top: n,
		left: r,
		width: i,
		height: a
	};
}
function cl(e, t, n) {
	let { top: r, left: i, width: a, height: o } = n || sl(e, t), { scrollTop: s, scrollLeft: c, clientTop: l, clientLeft: u } = document.documentElement;
	return {
		top: r + s - l,
		left: i + c - u,
		width: a,
		height: o
	};
}
function ll(e, t, n, r) {
	let i = window.getComputedStyle(e), a;
	if (i.position === "fixed") a = r || sl(e, n);
	else {
		a = cl(e, n, r);
		let i = cl(t, n), o = window.getComputedStyle(t);
		i.top += (parseInt(o.borderTopWidth, 10) || 0) - t.scrollTop, i.left += (parseInt(o.borderLeftWidth, 10) || 0) - t.scrollLeft, a.top -= i.top, a.left -= i.left;
	}
	return a.top -= parseInt(i.marginTop, 10) || 0, a.left -= parseInt(i.marginLeft, 10) || 0, a;
}
function ul(e) {
	let t = e.offsetParent;
	if (t && t === document.body && window.getComputedStyle(t).position === "static" && !dl(t) && (t = document.documentElement), t == null) for (t = e.parentElement; t && !dl(t);) t = t.parentElement;
	return t || document.documentElement;
}
function dl(e) {
	let t = window.getComputedStyle(e);
	return t.transform !== "none" || /transform|perspective/.test(t.willChange) || t.filter !== "none" || t.contain === "paint" || "backdropFilter" in t && t.backdropFilter !== "none" || "WebkitBackdropFilter" in t && t.WebkitBackdropFilter !== "none";
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/useCloseOnScroll.mjs
var fl = /* @__PURE__ */ new WeakMap();
function pl(e) {
	let { triggerRef: t, isOpen: n, onClose: r } = e;
	(0, _.useEffect)(() => !n || r === null ? void 0 : ea(aa(t.current), "scroll", (e) => {
		let n = F(e);
		if (!t.current || n instanceof Node && !P(n, t.current) || n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) return;
		let i = r || fl.get(t.current);
		i && i();
	}, !0), [
		n,
		r,
		t
	]);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useResizeObserver.mjs
function ml() {
	return window.ResizeObserver !== void 0;
}
function hl(e) {
	let { ref: t, box: n, onResize: r } = e, i = L(r);
	(0, _.useEffect)(() => {
		let e = t?.current;
		if (e) {
			if (ml()) {
				let t = new window.ResizeObserver((e) => {
					e.length && i();
				});
				return t.observe(e, { box: n }), () => {
					e && t.unobserve(e);
				};
			}
			return window.addEventListener("resize", i, !1), () => {
				window.removeEventListener("resize", i, !1);
			};
		}
	}, [t, n]);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/useOverlayPosition.mjs
var gl = typeof document < "u" ? window.visualViewport : null;
function _l(e) {
	let { direction: t } = Li(), { arrowSize: n, targetRef: r, overlayRef: i, arrowRef: a, scrollRef: o = i, placement: s = "bottom", containerPadding: c = 12, shouldFlip: l = !0, boundaryElement: u = typeof document < "u" ? document.body : null, offset: d = 0, crossOffset: f = 0, shouldUpdatePosition: p = !0, isOpen: m = !0, onClose: h, maxHeight: g, arrowBoundaryOffset: v = 0, getTargetRect: y } = e, [b, x] = (0, _.useState)(null), S = [
		p,
		s,
		i.current,
		r.current,
		a?.current,
		o.current,
		c,
		l,
		u,
		d,
		f,
		m,
		t,
		g,
		v,
		n
	], C = (0, _.useRef)(gl?.scale);
	(0, _.useEffect)(() => {
		m && (C.current = gl?.scale);
	}, [m]);
	let w = (0, _.useCallback)(() => {
		if (p === !1 || !m || !i.current || !r.current || !u || gl?.scale !== C.current) return;
		let e = null;
		if (o.current && oa(o.current)) {
			let t = ia()?.getBoundingClientRect(), n = o.current.getBoundingClientRect();
			e = {
				type: "top",
				offset: (t?.top ?? 0) - n.top
			}, e.offset > n.height / 2 && (e.type = "bottom", e.offset = (t?.bottom ?? 0) - n.bottom);
		}
		let h = i.current;
		!g && i.current && (h.style.top = "0px", h.style.bottom = "", h.style.maxHeight = (window.visualViewport?.height ?? window.innerHeight) + "px");
		let _ = ol({
			placement: yl(s, t),
			overlayNode: i.current,
			targetNode: r.current,
			scrollNode: o.current || i.current,
			padding: c,
			shouldFlip: l,
			boundaryElement: u,
			offset: d,
			crossOffset: f,
			maxHeight: g,
			arrowSize: n ?? (a?.current ? sl(a.current, !0).width : 0),
			arrowBoundaryOffset: v,
			targetRect: y?.(r.current)
		});
		if (!_.position) return;
		h.style.top = "", h.style.bottom = "", h.style.left = "", h.style.right = "", Object.keys(_.position).forEach((e) => h.style[e] = _.position[e] + "px"), h.style.maxHeight = _.maxHeight == null ? "" : _.maxHeight + "px";
		let b = ia();
		if (e && b && o.current) {
			let t = b.getBoundingClientRect(), n = o.current.getBoundingClientRect(), r = t[e.type] - n[e.type];
			o.current.scrollTop += r - e.offset;
		}
		x(_);
	}, S);
	Nr(w, S), vl(w), hl({
		ref: i,
		onResize: w
	}), hl({
		ref: r,
		onResize: w
	});
	let T = (0, _.useRef)(!1);
	Nr(() => {
		let e, t = () => {
			T.current = !0, clearTimeout(e), e = setTimeout(() => {
				T.current = !1;
			}, 500), w();
		}, n = () => {
			T.current && t();
		};
		gl?.addEventListener("resize", t), gl?.addEventListener("scroll", n);
		let r = ea(aa(window), "scroll", n);
		return () => {
			gl?.removeEventListener("resize", t), gl?.removeEventListener("scroll", n), r();
		};
	}, [w]);
	let ee = (0, _.useCallback)(() => {
		T.current || h?.();
	}, [h, T]);
	return pl({
		triggerRef: r,
		isOpen: m,
		onClose: h && ee
	}), {
		overlayProps: { style: {
			position: b ? "absolute" : "fixed",
			top: b ? void 0 : 0,
			left: b ? void 0 : 0,
			zIndex: 1e5,
			...b?.position,
			maxHeight: b?.maxHeight ?? "100vh"
		} },
		placement: b?.placement ?? null,
		triggerAnchorPoint: b?.triggerAnchorPoint ?? null,
		arrowProps: {
			"aria-hidden": "true",
			role: "presentation",
			style: {
				left: b?.arrowOffsetLeft,
				top: b?.arrowOffsetTop
			}
		},
		updatePosition: w
	};
}
function vl(e) {
	Nr(() => (window.addEventListener("resize", e, !1), () => {
		window.removeEventListener("resize", e, !1);
	}), [e]);
}
function yl(e, t) {
	return t === "rtl" ? e.replace("start", "right").replace("end", "left") : e.replace("start", "left").replace("end", "right");
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/focus/FocusScope.mjs
var bl = /*#__PURE__*/ _.createContext(null), xl = "react-aria-focus-scope-restore", Sl = null;
function Cl(e) {
	let { children: t, contain: n, restoreFocus: r, autoFocus: i } = e, a = (0, _.useRef)(null), o = (0, _.useRef)(null), s = (0, _.useRef)([]), { parentNode: c } = (0, _.useContext)(bl) || {}, l = (0, _.useMemo)(() => new Gl({ scopeRef: s }), [s]);
	Nr(() => {
		let e = c || Kl.root;
		if (Kl.getTreeNode(e.scopeRef) && Sl && !Pl(Sl, e.scopeRef)) {
			let t = Kl.getTreeNode(Sl);
			t && (e = t);
		}
		e.addChild(l), Kl.addNode(l);
	}, [l, c]), Nr(() => {
		let e = Kl.getTreeNode(s);
		e && (e.contain = !!n);
	}, [n]), Nr(() => {
		let e = a.current?.nextSibling, t = [], n = (e) => e.stopPropagation();
		for (; e && e !== o.current;) t.push(e), e.addEventListener(xl, n), e = e.nextSibling;
		return s.current = t, () => {
			for (let e of t) e.removeEventListener(xl, n);
		};
	}, [t]), zl(s, r, n), kl(s, n), Vl(s, r, n), Rl(s, i), (0, _.useEffect)(() => {
		let e = ia(N(s.current ? s.current[0] : void 0)), t = null;
		if (jl(e, s.current)) {
			for (let n of Kl.traverse()) n.scopeRef && jl(e, n.scopeRef.current) && (t = n);
			t === Kl.getTreeNode(s) && (Sl = t.scopeRef);
		}
	}, [s]), Nr(() => () => {
		let e = Kl.getTreeNode(s)?.parent?.scopeRef ?? null;
		(s === Sl || Pl(s, Sl)) && (!e || Kl.getTreeNode(e)) && (Sl = e), Kl.removeTreeNode(s);
	}, [s]);
	let u = (0, _.useMemo)(() => wl(s), []), d = (0, _.useMemo)(() => ({
		focusManager: u,
		parentNode: l
	}), [l, u]);
	return /*#__PURE__*/ _.createElement(bl.Provider, { value: d }, /*#__PURE__*/ _.createElement("span", {
		"data-focus-scope-start": !0,
		hidden: !0,
		ref: a
	}), t, /*#__PURE__*/ _.createElement("span", {
		"data-focus-scope-end": !0,
		hidden: !0,
		ref: o
	}));
}
function wl(e) {
	return {
		focusNext(t = {}) {
			let n = e.current, { from: r, tabbable: i, wrap: a, accept: o } = t, s = r || ia(N(n[0] ?? void 0)), c = n[0].previousElementSibling, l = Ul(Tl(n), {
				tabbable: i,
				accept: o
			}, n);
			l.currentNode = jl(s, n) ? s : c;
			let u = l.nextNode();
			return !u && a && (l.currentNode = c, u = l.nextNode()), u && Fl(u, !0), u;
		},
		focusPrevious(t = {}) {
			let n = e.current, { from: r, tabbable: i, wrap: a, accept: o } = t, s = r || ia(N(n[0] ?? void 0)), c = n[n.length - 1].nextElementSibling, l = Ul(Tl(n), {
				tabbable: i,
				accept: o
			}, n);
			l.currentNode = jl(s, n) ? s : c;
			let u = l.previousNode();
			return !u && a && (l.currentNode = c, u = l.previousNode()), u && Fl(u, !0), u;
		},
		focusFirst(t = {}) {
			let n = e.current, { tabbable: r, accept: i } = t, a = Ul(Tl(n), {
				tabbable: r,
				accept: i
			}, n);
			a.currentNode = n[0].previousElementSibling;
			let o = a.nextNode();
			return o && Fl(o, !0), o;
		},
		focusLast(t = {}) {
			let n = e.current, { tabbable: r, accept: i } = t, a = Ul(Tl(n), {
				tabbable: r,
				accept: i
			}, n);
			a.currentNode = n[n.length - 1].nextElementSibling;
			let o = a.previousNode();
			return o && Fl(o, !0), o;
		}
	};
}
function Tl(e) {
	return e[0].parentElement;
}
function El(e) {
	let t = Kl.getTreeNode(Sl);
	for (; t && t.scopeRef !== e;) {
		if (t.contain) return !1;
		t = t.parent;
	}
	return !0;
}
function Dl(e) {
	if (!e.form) return Array.from(N(e).querySelectorAll(`input[type="radio"][name="${CSS.escape(e.name)}"]`)).filter((e) => !e.form);
	let t = e.form.elements.namedItem(e.name), n = Yi(e);
	return t instanceof n.RadioNodeList ? Array.from(t).filter((e) => e instanceof n.HTMLInputElement) : t instanceof n.HTMLInputElement ? [t] : [];
}
function Ol(e) {
	if (e.checked) return !0;
	let t = Dl(e);
	return t.length > 0 && !t.some((e) => e.checked);
}
function kl(e, t) {
	let n = (0, _.useRef)(void 0), r = (0, _.useRef)(void 0);
	Nr(() => {
		let i = e.current;
		if (!t) {
			r.current &&= (cancelAnimationFrame(r.current), void 0);
			return;
		}
		let a = N(i ? i[0] : void 0), o = (t) => {
			if (t.key !== "Tab" || t.altKey || t.ctrlKey || t.metaKey || !El(e) || t.isComposing) return;
			let n = ia(a), r = e.current;
			if (!r || !jl(n, r)) return;
			let i = Ul(Tl(r), { tabbable: !0 }, r);
			if (!n) return;
			i.currentNode = n;
			let o = t.shiftKey ? i.previousNode() : i.nextNode();
			o ||= (i.currentNode = t.shiftKey ? r[r.length - 1].nextElementSibling : r[0].previousElementSibling, t.shiftKey ? i.previousNode() : i.nextNode()), t.preventDefault(), o && (Fl(o, !0), o instanceof Yi(o).HTMLInputElement && o.select());
		}, s = (t) => {
			(!Sl || Pl(Sl, e)) && jl(F(t), e.current) ? (Sl = e, n.current = F(t)) : El(e) && !Ml(F(t), e) ? n.current ? Fl(n.current) : Sl && Sl.current && Ll(Sl.current) : El(e) && (n.current = F(t));
		}, c = (t) => {
			r.current && cancelAnimationFrame(r.current), r.current = requestAnimationFrame(() => {
				let r = oo(), i = (r === "virtual" || r === null) && ja() && Aa(), o = ia(a);
				if (!i && o && El(e) && !Ml(o, e)) {
					Sl = e;
					let r = F(t);
					r && r.isConnected ? (n.current = r, Fl(n.current)) : Sl.current && Ll(Sl.current);
				}
			});
		};
		return a.addEventListener("keydown", o, !1), a.addEventListener("focusin", s, !1), i?.forEach((e) => e.addEventListener("focusin", s, !1)), i?.forEach((e) => e.addEventListener("focusout", c, !1)), () => {
			a.removeEventListener("keydown", o, !1), a.removeEventListener("focusin", s, !1), i?.forEach((e) => e.removeEventListener("focusin", s, !1)), i?.forEach((e) => e.removeEventListener("focusout", c, !1));
		};
	}, [e, t]), Nr(() => () => {
		r.current && cancelAnimationFrame(r.current);
	}, [r]);
}
function Al(e) {
	return Ml(e);
}
function jl(e, t) {
	return !e || !t ? !1 : t.some((t) => P(t, e));
}
function Ml(e, t = null) {
	if (e instanceof Element && e.closest("[data-react-aria-top-layer]")) return !0;
	for (let { scopeRef: n } of Kl.traverse(Kl.getTreeNode(t))) if (n && jl(e, n.current)) return !0;
	return !1;
}
function Nl(e) {
	return Ml(e, Sl);
}
function Pl(e, t) {
	let n = Kl.getTreeNode(t)?.parent;
	for (; n;) {
		if (n.scopeRef === e) return !0;
		n = n.parent;
	}
	return !1;
}
function Fl(e, t = !1) {
	if (e != null && !t) try {
		_o(e);
	} catch {}
	else if (e != null) try {
		e.focus();
	} catch {}
}
function Il(e, t = !0) {
	let n = e[0].previousElementSibling, r = Tl(e), i = Ul(r, { tabbable: t }, e);
	i.currentNode = n;
	let a = i.nextNode();
	return t && !a && (r = Tl(e), i = Ul(r, { tabbable: !1 }, e), i.currentNode = n, a = i.nextNode()), a;
}
function Ll(e, t = !0) {
	Fl(Il(e, t));
}
function Rl(e, t) {
	let n = _.useRef(t);
	(0, _.useEffect)(() => {
		n.current && (Sl = e, !jl(ia(N(e.current ? e.current[0] : void 0)), Sl.current) && e.current && Ll(e.current)), n.current = !1;
	}, [e]);
}
function zl(e, t, n) {
	Nr(() => {
		if (t || n) return;
		let r = e.current, i = N(r ? r[0] : void 0), a = (t) => {
			let n = F(t);
			jl(n, e.current) ? Sl = e : Al(n) || (Sl = null);
		};
		return i.addEventListener("focusin", a, !1), r?.forEach((e) => e.addEventListener("focusin", a, !1)), () => {
			i.removeEventListener("focusin", a, !1), r?.forEach((e) => e.removeEventListener("focusin", a, !1));
		};
	}, [
		e,
		t,
		n
	]);
}
function Bl(e) {
	let t = Kl.getTreeNode(Sl);
	for (; t && t.scopeRef !== e;) {
		if (t.nodeToRestore) return !1;
		t = t.parent;
	}
	return t?.scopeRef === e;
}
function Vl(e, t, n) {
	let r = (0, _.useRef)(typeof document < "u" ? ia(N(e.current ? e.current[0] : void 0)) : null);
	Nr(() => {
		let r = e.current, i = N(r ? r[0] : void 0);
		if (!t || n) return;
		let a = () => {
			(!Sl || Pl(Sl, e)) && jl(ia(i), e.current) && (Sl = e);
		};
		return i.addEventListener("focusin", a, !1), r?.forEach((e) => e.addEventListener("focusin", a, !1)), () => {
			i.removeEventListener("focusin", a, !1), r?.forEach((e) => e.removeEventListener("focusin", a, !1));
		};
	}, [e, n]), Nr(() => {
		let r = N(e.current ? e.current[0] : void 0);
		if (!t) return;
		let i = (t) => {
			if (t.key !== "Tab" || t.altKey || t.ctrlKey || t.metaKey || !El(e) || t.isComposing) return;
			let n = r.activeElement;
			if (!Ml(n, e) || !Bl(e)) return;
			let i = Kl.getTreeNode(e);
			if (!i) return;
			let a = i.nodeToRestore, o = Ul(r.body, { tabbable: !0 });
			o.currentNode = n;
			let s = t.shiftKey ? o.previousNode() : o.nextNode();
			if ((!a || !a.isConnected || a === r.body) && (a = void 0, i.nodeToRestore = void 0), (!s || !Ml(s, e)) && a) {
				o.currentNode = a;
				do
					s = t.shiftKey ? o.previousNode() : o.nextNode();
				while (Ml(s, e));
				t.preventDefault(), t.stopPropagation(), s ? Fl(s, !0) : Al(a) ? Fl(a, !0) : n.blur();
			}
		};
		return n || r.addEventListener("keydown", i, !0), () => {
			n || r.removeEventListener("keydown", i, !0);
		};
	}, [
		e,
		t,
		n
	]), Nr(() => {
		let n = N(e.current ? e.current[0] : void 0);
		if (!t) return;
		let i = Kl.getTreeNode(e);
		if (i) return i.nodeToRestore = r.current ?? void 0, () => {
			let r = Kl.getTreeNode(e);
			if (!r) return;
			let i = r.nodeToRestore, a = ia(n);
			if (t && i && (a && Ml(a, e) || a === n.body && Bl(e))) {
				let t = Kl.clone();
				requestAnimationFrame(() => {
					if (n.activeElement === n.body) {
						let n = t.getTreeNode(e);
						for (; n;) {
							if (n.nodeToRestore && n.nodeToRestore.isConnected) {
								Hl(n.nodeToRestore);
								return;
							}
							n = n.parent;
						}
						for (n = t.getTreeNode(e); n;) {
							if (n.scopeRef && n.scopeRef.current && Kl.getTreeNode(n.scopeRef)) {
								let e = Il(n.scopeRef.current, !0);
								if (e) {
									Hl(e);
									return;
								}
							}
							n = n.parent;
						}
					}
				});
			}
		};
	}, [e, t]);
}
function Hl(e) {
	e.dispatchEvent(new CustomEvent(xl, {
		bubbles: !0,
		cancelable: !0
	})) && Fl(e);
}
function Ul(e, t, n) {
	let r = t?.tabbable ? ma : pa, i = N(e?.nodeType === Node.ELEMENT_NODE ? e : null), a = Lc(i, e || i, NodeFilter.SHOW_ELEMENT, { acceptNode(e) {
		return P(t?.from, e) || t?.tabbable && e.tagName === "INPUT" && e.getAttribute("type") === "radio" && (!Ol(e) || a.currentNode.tagName === "INPUT" && a.currentNode.type === "radio" && a.currentNode.name === e.name) ? NodeFilter.FILTER_REJECT : r(e) && (!n || jl(e, n)) && (!t?.accept || t.accept(e)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
	} });
	return t?.from && (a.currentNode = t.from), a;
}
var Wl = class e {
	constructor() {
		this.fastMap = /* @__PURE__ */ new Map(), this.root = new Gl({ scopeRef: null }), this.fastMap.set(null, this.root);
	}
	get size() {
		return this.fastMap.size;
	}
	getTreeNode(e) {
		return this.fastMap.get(e);
	}
	addTreeNode(e, t, n) {
		let r = this.fastMap.get(t ?? null);
		if (!r) return;
		let i = new Gl({ scopeRef: e });
		r.addChild(i), i.parent = r, this.fastMap.set(e, i), n && (i.nodeToRestore = n);
	}
	addNode(e) {
		this.fastMap.set(e.scopeRef, e);
	}
	removeTreeNode(e) {
		if (e === null) return;
		let t = this.fastMap.get(e);
		if (!t) return;
		let n = t.parent;
		for (let e of this.traverse()) e !== t && t.nodeToRestore && e.nodeToRestore && t.scopeRef && t.scopeRef.current && jl(e.nodeToRestore, t.scopeRef.current) && (e.nodeToRestore = t.nodeToRestore);
		let r = t.children;
		n && (n.removeChild(t), r.size > 0 && r.forEach((e) => n && n.addChild(e))), this.fastMap.delete(t.scopeRef);
	}
	*traverse(e = this.root) {
		if (e.scopeRef != null && (yield e), e.children.size > 0) for (let t of e.children) yield* this.traverse(t);
	}
	clone() {
		let t = new e();
		for (let e of this.traverse()) t.addTreeNode(e.scopeRef, e.parent?.scopeRef ?? null, e.nodeToRestore);
		return t;
	}
}, Gl = class {
	constructor(e) {
		this.children = /* @__PURE__ */ new Set(), this.contain = !1, this.scopeRef = e.scopeRef;
	}
	addChild(e) {
		this.children.add(e), e.parent = this;
	}
	removeChild(e) {
		this.children.delete(e), e.parent = void 0;
	}
}, Kl = new Wl();
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useInteractOutside.mjs
function ql(e) {
	let { ref: t, onInteractOutside: n, isDisabled: r, onInteractOutsideStart: i } = e, a = (0, _.useRef)({
		isPointerDown: !1,
		ignoreEmulatedMouseEvents: !1
	}), o = L((e) => {
		n && Jl(e, t) && (i && i(e), a.current.isPointerDown = !0);
	}), s = L((e) => {
		n && n(e);
	});
	(0, _.useEffect)(() => {
		let e = a.current;
		if (r) return;
		let n = t.current, i = N(n);
		if (typeof PointerEvent < "u") {
			let n = (n) => {
				e.isPointerDown && Jl(n, t) && s(n), e.isPointerDown = !1;
			};
			return i.addEventListener("pointerdown", o, !0), i.addEventListener("click", n, !0), () => {
				i.removeEventListener("pointerdown", o, !0), i.removeEventListener("click", n, !0);
			};
		}
	}, [t, r]);
}
function Jl(e, t) {
	if (e.button > 0) return !1;
	let n = F(e);
	if (n) {
		let e = n.ownerDocument;
		if (!e || !P(e.documentElement, n) || n.closest("[data-react-aria-top-layer]")) return !1;
	}
	return t.current ? !e.composedPath().includes(t.current) : !1;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/useOverlay.mjs
var Yl = [];
function Xl(e, t) {
	let { onClose: n, shouldCloseOnBlur: r, isOpen: i, isDismissable: a = !1, isKeyboardDismissDisabled: o = !1, shouldCloseOnInteractOutside: s } = e, c = (0, _.useRef)(void 0);
	(0, _.useEffect)(() => {
		if (i && !Yl.includes(t)) return Yl.push(t), () => {
			let e = Yl.indexOf(t);
			e >= 0 && Yl.splice(e, 1);
		};
	}, [i, t]);
	let l = () => {
		Yl[Yl.length - 1] === t && n && n();
	}, u = (e) => {
		let n = Yl[Yl.length - 1];
		c.current = n, (!s || s(F(e))) && n === t && e.stopPropagation();
	}, d = (e) => {
		(!s || s(F(e))) && (Yl[Yl.length - 1] === t && e.stopPropagation(), c.current === t && l()), c.current = void 0;
	}, { keyboardProps: f } = Mo({ shortcuts: { Escape: () => {
		if (!o) {
			l();
			return;
		}
		return !1;
	} } });
	ql({
		ref: t,
		onInteractOutside: a && i ? d : void 0,
		onInteractOutsideStart: u
	});
	let { focusWithinProps: p } = ls({
		isDisabled: !r,
		onBlurWithin: (e) => {
			e.relatedTarget && !Nl(e.relatedTarget) && (!s || s(e.relatedTarget)) && n?.();
		}
	});
	return {
		overlayProps: {
			...f,
			...p
		},
		underlayProps: {}
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/isScrollable.mjs
function Zl(e, t) {
	if (!e) return !1;
	let n = window.getComputedStyle(e), r = document.scrollingElement || document.documentElement, i = /(auto|scroll)/.test(n.overflow + n.overflowX + n.overflowY);
	return e === r && n.overflow !== "hidden" && (i = !0), i && t && (i = e.scrollHeight !== e.clientHeight || e.scrollWidth !== e.clientWidth), i;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/getScrollParent.mjs
function Ql(e, t) {
	let n = e;
	for (Zl(n, t) && (n = n.parentElement); n && !Zl(n, t);) n = n.parentElement;
	return n || document.scrollingElement || document.documentElement;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/usePreventScroll.mjs
var $l = typeof document < "u" && window.visualViewport, eu = 0, tu;
function nu(e = {}) {
	let { isDisabled: t } = e;
	Nr(() => {
		if (!t) return eu++, eu === 1 && (tu = Da() && ka() ? iu() : ru()), () => {
			eu--, eu === 0 && tu();
		};
	}, [t]);
}
function ru() {
	let e = window.innerWidth - document.documentElement.clientWidth;
	return Mr(e > 0 && ("scrollbarGutter" in document.documentElement.style ? ta(document.documentElement, "scrollbar-gutter", "stable") : ta(document.documentElement, "padding-right", `${e}px`)), ta(document.documentElement, "overflow", "hidden"));
}
function iu() {
	let e = ta(document.documentElement, "overflow", "hidden"), t, n = !1, r = (e) => {
		let r = F(e);
		t = Zl(r) ? r : Ql(r, !0), n = !1;
		let i = r.ownerDocument.defaultView.getSelection();
		i && !i.isCollapsed && i.containsNode(r, !0) && (n = !0), e.composedPath().some((e) => e instanceof HTMLInputElement && e.type === "range") && (n = !0), "selectionStart" in r && "selectionEnd" in r && r.selectionStart < r.selectionEnd && r.ownerDocument.activeElement === r && (n = !0);
	}, i = document.createElement("style"), a = Wo();
	a && (i.nonce = a), i.textContent = "@layer {\n  * {\n    overscroll-behavior: contain;\n  }\n}", document.head.prepend(i);
	let o = (e) => {
		if (!(e.touches.length === 2 || n)) {
			if (!t || t === document.documentElement || t === document.body) {
				e.preventDefault();
				return;
			}
			t.scrollHeight === t.clientHeight && t.scrollWidth === t.clientWidth && e.preventDefault();
		}
	}, s = (e) => {
		let t = F(e), n = e.relatedTarget;
		n && fc(n) ? (n.focus({ preventScroll: !0 }), au(n, fc(t))) : n || (t.parentElement?.closest("[tabindex]"))?.focus({ preventScroll: !0 });
	}, c = HTMLElement.prototype.focus;
	Reflect.defineProperty(HTMLElement.prototype, "focus", {
		configurable: !0,
		writable: !0,
		value: function(e) {
			let t = ia(), n = t != null && fc(t);
			c.call(this, {
				...e,
				preventScroll: !0
			}), (!e || !e.preventScroll) && au(this, n);
		}
	});
	let l = Mr(ea(document, "touchstart", r, {
		passive: !1,
		capture: !0
	}), ea(document, "touchmove", o, {
		passive: !1,
		capture: !0
	}), ea(document, "blur", s, !0));
	return () => {
		e(), l(), i.remove(), Reflect.defineProperty(HTMLElement.prototype, "focus", {
			configurable: !0,
			writable: !0,
			value: c
		});
	};
}
function au(e, t) {
	t || !$l ? ou(e) : $l.addEventListener("resize", () => ou(e), { once: !0 });
}
function ou(e) {
	let t = document.scrollingElement || document.documentElement, n = e;
	for (; n && n !== t;) {
		let e = Ql(n);
		if (e !== document.documentElement && e !== document.body && e !== n) {
			let t = e.getBoundingClientRect(), r = n.getBoundingClientRect();
			if (r.top < t.top || r.bottom > t.top + n.clientHeight) {
				let n = t.bottom;
				$l && (n = Math.min(n, $l.offsetTop + $l.height));
				let i = r.top - t.top - ((n - t.top) / 2 - r.height / 2);
				e.scrollTo({
					top: Math.max(0, Math.min(e.scrollHeight - e.clientHeight, e.scrollTop + i)),
					behavior: "smooth"
				});
			}
		}
		n = e.parentElement;
	}
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/usePopover.mjs
function su(e, t) {
	let { triggerRef: n, popoverRef: r, groupRef: i, isNonModal: a, isKeyboardDismissDisabled: o, shouldCloseOnInteractOutside: s, ...c } = e, l = c.trigger === "SubmenuTrigger", { overlayProps: u, underlayProps: d } = Xl({
		isOpen: t.isOpen,
		onClose: t.close,
		shouldCloseOnBlur: !0,
		isDismissable: !a || l,
		isKeyboardDismissDisabled: o,
		shouldCloseOnInteractOutside: s
	}, i ?? r), { overlayProps: f, arrowProps: p, placement: m, triggerAnchorPoint: h } = _l({
		...c,
		targetRef: n,
		overlayRef: r,
		isOpen: t.isOpen,
		onClose: a && !l ? t.close : null,
		getTargetRect: c.getTargetRect ?? (t.point ? () => new DOMRect(t.point.x, t.point.y, 0, 0) : void 0)
	});
	nu({ isDisabled: a || !t.isOpen }), (0, _.useEffect)(() => {
		if (t.isOpen && r.current) return a ? Uc(i?.current ?? r.current) : Hc([i?.current ?? r.current], { shouldUseInert: !0 });
	}, [
		a,
		t.isOpen,
		r,
		i
	]);
	let { focusWithinProps: g } = ls(e);
	return {
		popoverProps: ii(u, f, g),
		arrowProps: p,
		underlayProps: d,
		placement: m,
		triggerAnchorPoint: h
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/ar-AE.mjs
var cu = {};
cu = { dismiss: "تجاهل" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/bg-BG.mjs
var lu = {};
lu = { dismiss: "Отхвърляне" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/cs-CZ.mjs
var uu = {};
uu = { dismiss: "Odstranit" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/da-DK.mjs
var du = {};
du = { dismiss: "Luk" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/de-DE.mjs
var fu = {};
fu = { dismiss: "Schließen" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/el-GR.mjs
var pu = {};
pu = { dismiss: "Απόρριψη" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/en-US.mjs
var mu = {};
mu = { dismiss: "Dismiss" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/es-ES.mjs
var hu = {};
hu = { dismiss: "Descartar" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/et-EE.mjs
var gu = {};
gu = { dismiss: "Lõpeta" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/fi-FI.mjs
var _u = {};
_u = { dismiss: "Hylkää" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/fr-FR.mjs
var vu = {};
vu = { dismiss: "Rejeter" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/he-IL.mjs
var yu = {};
yu = { dismiss: "התעלם" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/hr-HR.mjs
var bu = {};
bu = { dismiss: "Odbaci" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/hu-HU.mjs
var xu = {};
xu = { dismiss: "Elutasítás" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/it-IT.mjs
var Su = {};
Su = { dismiss: "Ignora" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/ja-JP.mjs
var Cu = {};
Cu = { dismiss: "閉じる" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/ko-KR.mjs
var wu = {};
wu = { dismiss: "무시" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/lt-LT.mjs
var Tu = {};
Tu = { dismiss: "Atmesti" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/lv-LV.mjs
var Eu = {};
Eu = { dismiss: "Nerādīt" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/nb-NO.mjs
var Du = {};
Du = { dismiss: "Lukk" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/nl-NL.mjs
var Ou = {};
Ou = { dismiss: "Negeren" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/pl-PL.mjs
var ku = {};
ku = { dismiss: "Zignoruj" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/pt-BR.mjs
var Au = {};
Au = { dismiss: "Descartar" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/pt-PT.mjs
var ju = {};
ju = { dismiss: "Dispensar" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/ro-RO.mjs
var Mu = {};
Mu = { dismiss: "Revocare" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/ru-RU.mjs
var Nu = {};
Nu = { dismiss: "Пропустить" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/sk-SK.mjs
var Pu = {};
Pu = { dismiss: "Zrušiť" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/sl-SI.mjs
var Fu = {};
Fu = { dismiss: "Opusti" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/sr-SP.mjs
var Iu = {};
Iu = { dismiss: "Odbaci" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/sv-SE.mjs
var Lu = {};
Lu = { dismiss: "Avvisa" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/tr-TR.mjs
var Ru = {};
Ru = { dismiss: "Kapat" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/uk-UA.mjs
var zu = {};
zu = { dismiss: "Скасувати" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/zh-CN.mjs
var Bu = {};
Bu = { dismiss: "取消" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/zh-TW.mjs
var Vu = {};
Vu = { dismiss: "關閉" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/intlStrings.mjs
var Hu = {};
Hu = {
	"ar-AE": cu,
	"bg-BG": lu,
	"cs-CZ": uu,
	"da-DK": du,
	"de-DE": fu,
	"el-GR": pu,
	"en-US": mu,
	"es-ES": hu,
	"et-EE": gu,
	"fi-FI": _u,
	"fr-FR": vu,
	"he-IL": yu,
	"hr-HR": bu,
	"hu-HU": xu,
	"it-IT": Su,
	"ja-JP": Cu,
	"ko-KR": wu,
	"lt-LT": Tu,
	"lv-LV": Eu,
	"nb-NO": Du,
	"nl-NL": Ou,
	"pl-PL": ku,
	"pt-BR": Au,
	"pt-PT": ju,
	"ro-RO": Mu,
	"ru-RU": Nu,
	"sk-SK": Pu,
	"sl-SI": Fu,
	"sr-SP": Iu,
	"sv-SE": Lu,
	"tr-TR": Ru,
	"uk-UA": zu,
	"zh-CN": Bu,
	"zh-TW": Vu
};
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/visually-hidden/VisuallyHidden.mjs
var Uu = {
	border: 0,
	clip: "rect(0 0 0 0)",
	clipPath: "inset(50%)",
	height: "1px",
	margin: "-1px",
	overflow: "hidden",
	padding: 0,
	position: "absolute",
	width: "1px",
	whiteSpace: "nowrap"
};
function Wu(e = {}) {
	let { style: t, isFocusable: n } = e, [r, i] = (0, _.useState)(!1), { focusWithinProps: a } = ls({
		isDisabled: !n,
		onFocusWithinChange: (e) => i(e)
	}), o = (0, _.useMemo)(() => r ? t : t ? {
		...Uu,
		...t
	} : Uu, [r]);
	return { visuallyHiddenProps: {
		...a,
		style: o
	} };
}
function Gu(e) {
	let { children: t, elementType: n = "div", isFocusable: r, style: i, ...a } = e, { visuallyHiddenProps: o } = Wu(e);
	return /*#__PURE__*/ _.createElement(n, ii(a, o), t);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/DismissButton.mjs
function Ku(e) {
	return e && e.__esModule ? e.default : e;
}
function qu(e) {
	let { onDismiss: t, ...n } = e, r = Ei(n, Dc(Ku(Hu), "@react-aria/overlays").format("dismiss")), i = () => {
		t && t();
	};
	return /*#__PURE__*/ _.createElement(Gu, null, /*#__PURE__*/ _.createElement("button", {
		...r,
		tabIndex: -1,
		onClick: i,
		style: {
			width: 1,
			height: 1
		}
	}));
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/PressResponder.mjs
var Ju = /*#__PURE__*/ _.forwardRef(({ children: e, ...t }, n) => {
	let r = (0, _.useRef)(!1), i = (0, _.useContext)(Go), a = ii(i || {}, {
		...t,
		register() {
			r.current = !0, i && i.register();
		}
	});
	return a.ref = ai(n || i?.ref), No(i, a.ref), (0, _.useEffect)(() => {
		r.current ||= !0;
	}, []), /*#__PURE__*/ _.createElement(Go.Provider, { value: a }, e);
});
function Yu({ children: e }) {
	let t = (0, _.useMemo)(() => ({ register: () => {} }), []);
	return /*#__PURE__*/ _.createElement(Go.Provider, { value: t }, e);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/PortalProvider.mjs
var Xu = /*#__PURE__*/ (0, _.createContext)({});
function Zu() {
	return (0, _.useContext)(Xu) ?? {};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/Overlay.mjs
var Qu = /*#__PURE__*/ _.createContext(null);
function $u(e) {
	let t = Gr(), { portalContainer: n = t ? null : document.body, isExiting: r } = e, [i, a] = (0, _.useState)(!1), o = (0, _.useMemo)(() => ({
		contain: i,
		setContain: a
	}), [i, a]), { getContainer: s } = Zu();
	if (!e.portalContainer && s && (n = s()), !n) return null;
	let c = e.children;
	return e.disableFocusManagement || (c = /*#__PURE__*/ _.createElement(Cl, {
		restoreFocus: !0,
		contain: (e.shouldContainFocus || i) && !r
	}, c)), c = /*#__PURE__*/ _.createElement(Qu.Provider, { value: o }, /*#__PURE__*/ _.createElement(Yu, null, /*#__PURE__*/ _.createElement(Po.Provider, { value: null }, c))), /*#__PURE__*/ Jo.createPortal(c, n);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/overlays/useOverlayTriggerState.mjs
function ed(e) {
	let [t, n] = kc(e.isOpen, e.defaultOpen || !1, e.onOpenChange), [r, i] = (0, _.useState)(null);
	return {
		isOpen: t,
		setOpen: n,
		open: (0, _.useCallback)(() => {
			n(!0);
		}, [n]),
		close: (0, _.useCallback)(() => {
			n(!1);
		}, [n]),
		toggle: (0, _.useCallback)(() => {
			n(!t);
		}, [n, t]),
		point: r,
		setPoint: i
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/animation.mjs
function td(e, t = !0) {
	let [n, r] = (0, _.useState)(!0), i = n && t;
	return Nr(() => {
		if (i && e.current && "getAnimations" in e.current) for (let t of e.current.getAnimations()) t instanceof CSSTransition && t.cancel();
	}, [e, i]), rd(e, i, (0, _.useCallback)(() => r(!1), [])), i;
}
function nd(e, t) {
	let [n, r] = (0, _.useState)(t ? "open" : "closed");
	switch (n) {
		case "open":
			t || r("exiting");
			break;
		case "closed":
		case "exiting": t && r("open");
	}
	let i = n === "exiting";
	return rd(e, i, (0, _.useCallback)(() => {
		r((e) => e === "exiting" ? "closed" : e);
	}, [])), i;
}
function rd(e, t, n) {
	Nr(() => {
		if (t && e.current) {
			if (!("getAnimations" in e.current)) {
				n();
				return;
			}
			let t = e.current.getAnimations();
			if (t.length === 0) {
				n();
				return;
			}
			let r = !1;
			return Promise.allSettled(t.map((e) => e.finished)).then(() => {
				r || (0, Jo.flushSync)(() => {
					n();
				});
			}), () => {
				r = !0;
			};
		}
	}, [
		e,
		t,
		n
	]);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria-components/dist/private/Popover.mjs
var id = /*#__PURE__*/ (0, _.createContext)(null), ad = /*#__PURE__*/ (0, _.createContext)(null), od = /*#__PURE__*/ (0, _.forwardRef)(function(e, t) {
	[e, t] = ui(e, t, id);
	let n = (0, _.useContext)(dd), r = ed(e), i = e.isOpen != null || e.defaultOpen != null || !n ? r : n, a = nd(t, i.isOpen), o = e.isExiting || !e.shouldSkipAnimation && a || !1, s = vi(), { direction: c } = Li();
	if (s) {
		let t = e.children;
		return typeof t == "function" && (t = t({
			trigger: e.trigger || null,
			placement: "bottom",
			isEntering: !1,
			isExiting: !1,
			defaultChildren: null
		})), /*#__PURE__*/ _.createElement(_.Fragment, null, t);
	}
	return i && !i.isOpen && !o ? null : /*#__PURE__*/ _.createElement(sd, {
		...e,
		triggerRef: e.triggerRef,
		state: i,
		popoverRef: t,
		isExiting: o,
		dir: c
	});
});
function sd({ state: e, isExiting: t, UNSTABLE_portalContainer: n, clearContexts: r, ...i }) {
	let a = (0, _.useRef)(null), o = (0, _.useRef)(null), s = (0, _.useContext)(ad), c = s && i.trigger === "SubmenuTrigger", { popoverProps: l, underlayProps: u, arrowProps: d, placement: f, triggerAnchorPoint: p } = su({
		...i,
		offset: i.offset ?? 8,
		arrowRef: a,
		groupRef: c ? s : o
	}, e), m = i.popoverRef, h = td(m, !!f), g = i.isEntering || !i.shouldSkipAnimation && h || !1, v = ci({
		...i,
		defaultClassName: "react-aria-Popover",
		values: {
			trigger: i.trigger || null,
			placement: f,
			isEntering: g,
			isExiting: t
		}
	}), y = !i.isNonModal || i.trigger === "SubmenuTrigger" || i.trigger === "PreviewTrigger", [b, x] = (0, _.useState)(i.trigger === "PreviewTrigger");
	Nr(() => {
		m.current && x(y && !m.current.querySelector("[role=dialog]"));
	}, [m, y]), (0, _.useEffect)(() => {
		b && i.trigger !== "PreviewTrigger" && (i.trigger !== "SubmenuTrigger" || oo() !== "pointer") && m.current && !oa(m.current) && _o(m.current);
	}, [
		b,
		m,
		i.trigger
	]);
	let S = (0, _.useMemo)(() => {
		let e = v.children;
		if (r) for (let t of r) e = /*#__PURE__*/ _.createElement(t.Provider, { value: null }, e);
		return e;
	}, [v.children, r]), [C, w] = (0, _.useState)(null), T = (0, _.useCallback)(() => {
		i.triggerRef.current && w(i.triggerRef.current.getBoundingClientRect().width + "px");
	}, [i.triggerRef]);
	Nr(T, [T]), hl({
		ref: v.style?.["--trigger-width"] ? void 0 : i.triggerRef,
		onResize: T
	});
	let ee = {
		...l.style,
		"--trigger-anchor-point": p ? `${p.x}px ${p.y}px` : void 0,
		...v.style,
		"--trigger-width": v.style?.["--trigger-width"] || C
	}, E = /*#__PURE__*/ _.createElement(mi.div, {
		...ii(Ti(i, { global: !0 }), l),
		...v,
		id: b ? i.id : void 0,
		role: b ? "dialog" : void 0,
		tabIndex: b ? -1 : void 0,
		"aria-label": i["aria-label"],
		"aria-labelledby": i["aria-labelledby"],
		ref: m,
		slot: i.slot || void 0,
		style: ee,
		dir: i.dir,
		"data-trigger": i.trigger,
		"data-placement": f,
		"data-entering": g || void 0,
		"data-exiting": t || void 0
	}, !i.isNonModal && /*#__PURE__*/ _.createElement(qu, { onDismiss: e.close }), /*#__PURE__*/ _.createElement(Fc.Provider, { value: {
		...d,
		placement: f,
		ref: a
	} }, S), /*#__PURE__*/ _.createElement(qu, { onDismiss: e.close }));
	return c ? /*#__PURE__*/ _.createElement($u, {
		...i,
		shouldContainFocus: b && i.trigger !== "PreviewTrigger",
		isExiting: t,
		portalContainer: n ?? s?.current ?? void 0
	}, E) : /*#__PURE__*/ _.createElement($u, {
		...i,
		shouldContainFocus: b && i.trigger !== "PreviewTrigger",
		isExiting: t,
		portalContainer: n
	}, !i.isNonModal && e.isOpen && /*#__PURE__*/ _.createElement("div", {
		"data-testid": "underlay",
		...u,
		style: {
			position: "fixed",
			inset: 0
		}
	}), /*#__PURE__*/ _.createElement("div", {
		ref: o,
		style: { display: "contents" }
	}, /*#__PURE__*/ _.createElement(ad.Provider, { value: o }, E)));
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria-components/dist/private/Text.mjs
var cd = /*#__PURE__*/ (0, _.createContext)({});
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/menu/useMenuTriggerState.mjs
function ld(e) {
	let t = ed(e), [n, r] = (0, _.useState)(null), [i, a] = (0, _.useState)([]), o = () => {
		a([]), t.close();
	}, s = (e, t) => {
		a((n) => t > n.length ? n : [...n.slice(0, t), e]);
	}, c = (e, t) => {
		a((n) => n[t] === e ? n.slice(0, t) : n);
	};
	return {
		focusStrategy: n,
		...t,
		open(e = null) {
			r(e), t.open();
		},
		toggle(e = null) {
			r(e), t.toggle();
		},
		close() {
			o();
		},
		expandedKeysStack: i,
		openSubmenu: s,
		closeSubmenu: c
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/useOverlayTrigger.mjs
function ud(e, t, n) {
	let { type: r } = e, { isOpen: i } = t;
	(0, _.useEffect)(() => {
		n && n.current && fl.set(n.current, t.close);
	});
	let a;
	r === "menu" ? a = !0 : r === "listbox" && (a = "listbox");
	let o = Zr();
	return {
		triggerProps: {
			"aria-haspopup": a,
			"aria-expanded": i,
			"aria-controls": i ? o : void 0,
			onPress: t.toggle
		},
		overlayProps: { id: o }
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria-components/dist/private/Dialog.mjs
var dd = /*#__PURE__*/ (0, _.createContext)(null), fd = /*#__PURE__*/ (0, _.createContext)(null);
function pd(e) {
	let t = (0, _.useRef)({});
	return /*#__PURE__*/ _.createElement(fd.Provider, { value: t }, e.children);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria-components/dist/private/SelectionIndicator.mjs
var md = /*#__PURE__*/ (0, _.createContext)({ isSelected: !1 }), hd = /*#__PURE__*/ (0, _.createContext)({});
(class extends xs {
	static {
		this.type = "separator";
	}
	filter(e, t) {
		let n = t.getItem(this.prevKey);
		if (n && n.type !== "separator") {
			let n = this.clone();
			return t.addDescendants(n, e), n;
		}
		return null;
	}
});
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/ar-AE.mjs
var gd = {};
gd = { longPressMessage: "اضغط مطولاً أو اضغط على Alt + السهم لأسفل لفتح القائمة" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/bg-BG.mjs
var _d = {};
_d = { longPressMessage: "Натиснете продължително или натиснете Alt+ стрелка надолу, за да отворите менюто" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/cs-CZ.mjs
var vd = {};
vd = { longPressMessage: "Dlouhým stiskem nebo stisknutím kláves Alt + šipka dolů otevřete nabídku" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/da-DK.mjs
var yd = {};
yd = { longPressMessage: "Langt tryk eller tryk på Alt + pil ned for at åbne menuen" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/de-DE.mjs
var bd = {};
bd = { longPressMessage: "Drücken Sie lange oder drücken Sie Alt + Nach-unten, um das Menü zu öffnen" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/el-GR.mjs
var xd = {};
xd = { longPressMessage: "Πιέστε παρατεταμένα ή πατήστε Alt + κάτω βέλος για να ανοίξετε το μενού" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/en-US.mjs
var Sd = {};
Sd = { longPressMessage: "Long press or press Alt + ArrowDown to open menu" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/es-ES.mjs
var Cd = {};
Cd = { longPressMessage: "Mantenga pulsado o pulse Alt + flecha abajo para abrir el menú" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/et-EE.mjs
var wd = {};
wd = { longPressMessage: "Menüü avamiseks vajutage pikalt või vajutage klahve Alt + allanool" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/fi-FI.mjs
var Td = {};
Td = { longPressMessage: "Avaa valikko painamalla pohjassa tai näppäinyhdistelmällä Alt + Alanuoli" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/fr-FR.mjs
var Ed = {};
Ed = { longPressMessage: "Appuyez de manière prolongée ou appuyez sur Alt\xA0+\xA0Flèche vers le bas pour ouvrir le menu." };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/he-IL.mjs
var Dd = {};
Dd = { longPressMessage: "לחץ לחיצה ארוכה או הקש Alt + ArrowDown כדי לפתוח את התפריט" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/hr-HR.mjs
var Od = {};
Od = { longPressMessage: "Dugo pritisnite ili pritisnite Alt + strelicu prema dolje za otvaranje izbornika" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/hu-HU.mjs
var kd = {};
kd = { longPressMessage: "Nyomja meg hosszan, vagy nyomja meg az Alt + lefele nyíl gombot a menü megnyitásához" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/it-IT.mjs
var Ad = {};
Ad = { longPressMessage: "Premi a lungo o premi Alt + Freccia giù per aprire il menu" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/ja-JP.mjs
var jd = {};
jd = { longPressMessage: "長押しまたは Alt+下矢印キーでメニューを開く" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/ko-KR.mjs
var Md = {};
Md = { longPressMessage: "길게 누르거나 Alt + 아래쪽 화살표를 눌러 메뉴 열기" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/lt-LT.mjs
var Nd = {};
Nd = { longPressMessage: "Norėdami atidaryti meniu, nuspaudę palaikykite arba paspauskite „Alt + ArrowDown“." };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/lv-LV.mjs
var Pd = {};
Pd = { longPressMessage: "Lai atvērtu izvēlni, turiet nospiestu vai nospiediet taustiņu kombināciju Alt + lejupvērstā bultiņa" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/nb-NO.mjs
var Fd = {};
Fd = { longPressMessage: "Langt trykk eller trykk Alt + PilNed for å åpne menyen" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/nl-NL.mjs
var Id = {};
Id = { longPressMessage: "Druk lang op Alt + pijl-omlaag of druk op Alt om het menu te openen" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/pl-PL.mjs
var Ld = {};
Ld = { longPressMessage: "Naciśnij i przytrzymaj lub naciśnij klawisze Alt + Strzałka w dół, aby otworzyć menu" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/pt-BR.mjs
var Rd = {};
Rd = { longPressMessage: "Pressione e segure ou pressione Alt + Seta para baixo para abrir o menu" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/pt-PT.mjs
var zd = {};
zd = { longPressMessage: "Prima continuamente ou prima Alt + Seta Para Baixo para abrir o menu" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/ro-RO.mjs
var Bd = {};
Bd = { longPressMessage: "Apăsați lung sau apăsați pe Alt + săgeată în jos pentru a deschide meniul" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/ru-RU.mjs
var Vd = {};
Vd = { longPressMessage: "Нажмите и удерживайте или нажмите Alt + Стрелка вниз, чтобы открыть меню" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/sk-SK.mjs
var Hd = {};
Hd = { longPressMessage: "Ponuku otvoríte dlhým stlačením alebo stlačením klávesu Alt + klávesu so šípkou nadol" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/sl-SI.mjs
var Ud = {};
Ud = { longPressMessage: "Za odprtje menija pritisnite in držite gumb ali pritisnite Alt+puščica navzdol" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/sr-SP.mjs
var Wd = {};
Wd = { longPressMessage: "Dugo pritisnite ili pritisnite Alt + strelicu prema dole da otvorite meni" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/sv-SE.mjs
var Gd = {};
Gd = { longPressMessage: "Håll nedtryckt eller tryck på Alt + pil nedåt för att öppna menyn" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/tr-TR.mjs
var Kd = {};
Kd = { longPressMessage: "Menüyü açmak için uzun basın veya Alt + Aşağı Ok tuşuna basın" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/uk-UA.mjs
var qd = {};
qd = { longPressMessage: "Довго або звичайно натисніть комбінацію клавіш Alt і стрілка вниз, щоб відкрити меню" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/zh-CN.mjs
var Jd = {};
Jd = { longPressMessage: "长按或按 Alt + 向下方向键以打开菜单" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/zh-TW.mjs
var Yd = {};
Yd = { longPressMessage: "長按或按 Alt+向下鍵以開啟功能表" };
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/menu/intlStrings.mjs
var Xd = {};
Xd = {
	"ar-AE": gd,
	"bg-BG": _d,
	"cs-CZ": vd,
	"da-DK": yd,
	"de-DE": bd,
	"el-GR": xd,
	"en-US": Sd,
	"es-ES": Cd,
	"et-EE": wd,
	"fi-FI": Td,
	"fr-FR": Ed,
	"he-IL": Dd,
	"hr-HR": Od,
	"hu-HU": kd,
	"it-IT": Ad,
	"ja-JP": jd,
	"ko-KR": Md,
	"lt-LT": Nd,
	"lv-LV": Pd,
	"nb-NO": Fd,
	"nl-NL": Id,
	"pl-PL": Ld,
	"pt-BR": Rd,
	"pt-PT": zd,
	"ro-RO": Bd,
	"ru-RU": Vd,
	"sk-SK": Hd,
	"sl-SI": Ud,
	"sr-SP": Wd,
	"sv-SE": Gd,
	"tr-TR": Kd,
	"uk-UA": qd,
	"zh-CN": Jd,
	"zh-TW": Yd
};
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useDescription.mjs
var Zd = 0, Qd = /* @__PURE__ */ new Map();
function $d(e) {
	let [t, n] = (0, _.useState)();
	return Nr(() => {
		if (!e) return;
		let t = Qd.get(e);
		if (t) n(t.element.id);
		else {
			let r = `react-aria-description-${Zd++}`;
			n(r);
			let i = document.createElement("div");
			i.id = r, i.style.display = "none", i.textContent = e, document.body.appendChild(i), t = {
				refCount: 0,
				element: i
			}, Qd.set(e, t);
		}
		return t.refCount++, () => {
			t && --t.refCount === 0 && (t.element.remove(), Qd.delete(e));
		};
	}, [e]), { "aria-describedby": e ? t : void 0 };
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useLongPress.mjs
var ef = 500;
function tf(e) {
	let { isDisabled: t, pointerType: n, onLongPressStart: r, onLongPressEnd: i, onLongPress: a, threshold: o = ef, accessibilityDescription: s } = e, c = (0, _.useRef)(void 0), { addGlobalListener: l, removeAllGlobalListeners: u } = qo(), d = (e) => n ? e.pointerType === n : e.pointerType === "mouse" || e.pointerType === "touch", { pressProps: f } = es({
		isDisabled: t,
		onPressStart(e) {
			if (e.continuePropagation(), d(e)) {
				r && r({
					...e,
					type: "longpressstart"
				}), c.current = setTimeout(() => {
					e.target.dispatchEvent(new PointerEvent("pointercancel", { bubbles: !0 })), l(e.target, "click", (e) => e.preventDefault(), { once: !0 }), N(e.target).activeElement !== e.target && Wi(e.target), a && a({
						...e,
						type: "longpress"
					}), c.current = void 0;
				}, o), e.pointerType === "touch" && l(e.target, "contextmenu", (e) => e.preventDefault(), { once: !0 });
				let t = Yi(e.target);
				l(t, "pointerup", () => {
					setTimeout(() => {
						u();
					}, 100);
				}, { once: !0 });
			}
		},
		onPressEnd(e) {
			c.current && clearTimeout(c.current), i && d(e) && i({
				...e,
				type: "longpressend"
			});
		}
	});
	return { longPressProps: ii(f, $d(a && !t ? s : void 0)) };
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useContextMenu.mjs
function nf(e) {
	let { onContextMenu: t } = e, n = (0, _.useRef)(!1), { longPressProps: r } = tf({
		onLongPressStart() {
			n.current = !1;
		},
		onLongPress(e) {
			n.current ? n.current = !1 : t?.({
				target: e.target,
				x: e.x,
				y: e.y
			});
		}
	});
	return t ? { contextMenuProps: ii(Da() ? r : {}, {
		onContextMenu(e) {
			e.stopPropagation(), e.preventDefault(), n.current = !0;
			let r = e.currentTarget.getBoundingClientRect();
			t({
				target: e.currentTarget,
				x: e.clientX - r.x,
				y: e.clientY - r.y
			});
		},
		onKeyDown(e) {
			if (wa() && e.ctrlKey && e.key === "Enter") {
				n.current = !1;
				let r = e.currentTarget;
				e.stopPropagation(), setTimeout(() => {
					if (n.current) n.current = !1;
					else {
						let e = r.getBoundingClientRect();
						t({
							target: r,
							x: e.width / 2,
							y: e.height / 2
						});
					}
				}, 10);
			}
		}
	}) } : { contextMenuProps: {} };
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/menu/useMenuTrigger.mjs
function rf(e) {
	return e && e.__esModule ? e.default : e;
}
function af(e, t, n) {
	let { type: r = "menu", isDisabled: i, trigger: a = "press" } = e, o = Zr(), { triggerProps: s, overlayProps: c } = ud({ type: r }, t, n), l = (e, n, r = "first") => {
		if (!e || n.isDefaultPrevented()) return !1;
		t.toggle(r);
	}, { keyboardProps: u } = Mo({
		isDisabled: i,
		shortcuts: {
			Enter: (e) => l(a !== "longPress", e, "first"),
			" ": (e) => l(a !== "longPress", e, "first"),
			ArrowDown: (e) => l(a !== "longPress", e, "first"),
			ArrowUp: (e) => l(a !== "longPress", e, "last"),
			"Alt+Enter": (e) => l(a === "longPress", e, "first"),
			"Alt+ ": (e) => l(a === "longPress", e, "first"),
			"Alt+ArrowDown": (e) => l(!0, e, "first"),
			"Alt+ArrowUp": (e) => l(!0, e, "last")
		}
	}), d = Dc(rf(Xd), "@react-aria/menu"), { longPressProps: f } = tf({
		isDisabled: i || a !== "longPress",
		accessibilityDescription: d.format("longPressMessage"),
		onLongPressStart() {
			t.close();
		},
		onLongPress() {
			t.open("first");
		}
	}), p = {
		preventFocusOnPress: !0,
		onPressStart(e) {
			e.pointerType !== "touch" && e.pointerType !== "keyboard" && !i && (Wi(e.target), t.open(e.pointerType === "virtual" ? "first" : null));
		},
		onPress(e) {
			e.pointerType === "touch" && !i && (Wi(e.target), t.toggle());
		}
	};
	delete s.onPress;
	let { contextMenuProps: m } = nf({ onContextMenu(e) {
		let n = e.target.getBoundingClientRect();
		t.setPoint({
			x: n.x + e.x,
			y: n.y + e.y
		}), t.open();
	} });
	(0, _.useEffect)(() => {
		if (t.isOpen && a === "contextMenu") {
			let e = (e) => {
				(e.button === 2 || e.button === 0 && e.ctrlKey === !0) && F(e) === document.body && t.close();
			};
			return document.addEventListener("mousedown", e), () => document.removeEventListener("mousedown", e);
		}
	}, [t, a]);
	let h;
	if (a === "press") h = {
		...p,
		...u
	};
	else if (a === "longPress") h = {
		...f,
		...u
	};
	else if (a === "contextMenu") {
		h = m;
		let { "aria-haspopup": e, "aria-expanded": t, "aria-controls": n, ...r } = s;
		s = r;
	}
	return {
		menuTriggerProps: {
			...s,
			...h,
			id: o
		},
		menuProps: {
			...c,
			"aria-labelledby": o,
			autoFocus: t.focusStrategy || !0,
			onClose: t.close
		}
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/menu/utils.mjs
var of = /* @__PURE__ */ new WeakMap();
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/selection/utils.mjs
function sf(e) {
	return Oa() ? e.altKey : e.ctrlKey;
}
function cf(e, t) {
	let n = `[data-key="${CSS.escape(String(t))}"]`, r = e.current?.dataset.collection;
	return r && (n = `[data-collection="${CSS.escape(r)}"]${n}`), e.current?.querySelector(n);
}
var lf = /* @__PURE__ */ new WeakMap();
function uf(e) {
	let t = Zr();
	return lf.set(e, t), t;
}
function df(e) {
	return lf.get(e);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/getScrollParents.mjs
function ff(e, t) {
	let n = [], r = document.scrollingElement || document.documentElement;
	for (; e && (Zl(e, t) && n.push(e), e !== r);) e = e.parentElement;
	return n;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/scrollIntoView.mjs
function pf(e, t, n = {}) {
	e !== t && mf(e, t, t.getBoundingClientRect(), n);
}
function mf(e, t, n, r = {}) {
	let { block: i = "nearest", inline: a = "nearest" } = r, o = e.scrollTop, s = e.scrollLeft, c = e.getBoundingClientRect(), l = window.getComputedStyle(t), u = window.getComputedStyle(e), d = document.scrollingElement || document.documentElement, f = e === d, p = e === d ? 0 : c.top, m = e === d ? e.clientHeight : c.bottom, h = e === d ? 0 : c.left, g = e === d ? e.clientWidth : c.right, _ = parseFloat(l.scrollMarginTop) || 0, v = parseFloat(l.scrollMarginBottom) || 0, y = parseFloat(l.scrollMarginLeft) || 0, b = parseFloat(l.scrollMarginRight) || 0, x = parseFloat(u.scrollPaddingTop) || 0, S = parseFloat(u.scrollPaddingBottom) || 0, C = parseFloat(u.scrollPaddingLeft) || 0, w = parseFloat(u.scrollPaddingRight) || 0, T = parseFloat(u.borderTopWidth) || 0, ee = parseFloat(u.borderBottomWidth) || 0, E = parseFloat(u.borderLeftWidth) || 0, te = parseFloat(u.borderRightWidth) || 0, D = n.top - _, O = n.bottom + v, ne = n.left - y, re = n.right + b, ie = e === d ? 0 : E + te, ae = e === d ? 0 : T + ee, oe = e === d ? 0 : e.offsetWidth - e.clientWidth - ie, se = e === d ? 0 : e.offsetHeight - e.clientHeight - ae, ce = p + (f ? 0 : T) + x, le = m - (f ? 0 : ee) - S - se, ue = h + (f ? 0 : E) + C, de = g - (f ? 0 : te) - w;
	Da() && ka() || u.direction === "ltr" ? de -= oe : u.direction === "rtl" && (ue += oe);
	let fe = D < ce || O > le, pe = ne < ue || re > de;
	if (fe && i === "start") o += D - ce;
	else if (fe && i === "center") o += (D + O) / 2 - (ce + le) / 2;
	else if (fe && i === "end") o += O - le;
	else if (fe && i === "nearest") {
		let e = D - ce, t = O - le;
		o += Math.abs(e) <= Math.abs(t) ? e : t;
	}
	if (pe && a === "start") s += ne - ue;
	else if (pe && a === "center") s += (ne + re) / 2 - (ue + de) / 2;
	else if (pe && a === "end") s += re - de;
	else if (pe && a === "nearest") {
		let e = ne - ue, t = re - de;
		s += Math.abs(e) <= Math.abs(t) ? e : t;
	}
	e.scrollTo({
		left: s,
		top: o
	});
}
function hf(e, t = {}) {
	let { containingElement: n } = t;
	if (e && e.isConnected) {
		let t = document.scrollingElement || document.documentElement;
		if (window.getComputedStyle(t).overflow !== "hidden") {
			let { left: t, top: r } = e.getBoundingClientRect();
			e?.scrollIntoView?.({ block: "nearest" });
			let { left: i, top: a } = e.getBoundingClientRect();
			(Math.abs(t - i) > 1 || Math.abs(r - a) > 1) && (n?.scrollIntoView?.({
				block: "center",
				inline: "center"
			}), e.scrollIntoView?.({ block: "nearest" }));
		} else {
			let { left: t, top: r } = e.getBoundingClientRect(), i = ff(e, !0);
			for (let t of i) pf(t, e);
			let { left: a, top: o } = e.getBoundingClientRect();
			if (Math.abs(t - a) > 1 || Math.abs(r - o) > 1) {
				i = n ? ff(n, !0) : [];
				for (let e of i) pf(e, n, {
					block: "center",
					inline: "center"
				});
				for (let t of ff(e, !0)) pf(t, e);
			}
		}
	}
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/selection/useTypeSelect.mjs
var gf = 1e3;
function _f(e) {
	let { keyboardDelegate: t, selectionManager: n, onTypeSelect: r } = e, i = (0, _.useRef)({
		search: "",
		timeout: void 0
	});
	return (0, _.useEffect)(() => {
		let e = i.current.timeout;
		return () => {
			clearTimeout(e);
		};
	}, [i]), { typeSelectProps: {
		onKeyDownCapture: t.getKeyForSearch ? (e) => {
			if (i.current.search.length > 0 && e.key === " ") {
				if (e.preventDefault(), (!("continuePropagation" in e) || "continuePropagation" in e && !e.isPropagationStopped()) && e.stopPropagation(), i.current.search += " ", t.getKeyForSearch != null) {
					let e = t.getKeyForSearch(i.current.search, n.focusedKey);
					e ??= t.getKeyForSearch(i.current.search), e != null && (n.setFocusedKey(e), r && r(e));
				}
				clearTimeout(i.current.timeout), i.current.timeout = setTimeout(() => {
					i.current.search = "";
				}, gf);
			}
		} : void 0,
		onKeyDown: t.getKeyForSearch ? (e) => {
			let a = vf(e.key);
			if (!(!a || e.ctrlKey || e.metaKey || e.altKey || !P(e.currentTarget, F(e)) || i.current.search.length === 0 && a === " ")) {
				if (i.current.search += a, t.getKeyForSearch != null) {
					let a = t.getKeyForSearch(i.current.search, n.focusedKey);
					if (a ??= t.getKeyForSearch(i.current.search), a != null) n.setFocusedKey(a), r && r(a), e.preventDefault(), "continuePropagation" in e || e.stopPropagation();
					else {
						i.current.search = "", clearTimeout(i.current.timeout), i.current.timeout = void 0;
						return;
					}
				}
				clearTimeout(i.current.timeout), i.current.timeout = setTimeout(() => {
					i.current.search = "";
				}, gf);
			}
		} : void 0
	} };
}
function vf(e) {
	return e.length === 1 || !/^[A-Z]/i.test(e) ? e : "";
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useUpdateLayoutEffect.mjs
function yf(e, t) {
	let n = (0, _.useRef)(!0), r = (0, _.useRef)(null);
	Nr(() => (n.current = !0, () => {
		n.current = !1;
	}), []), Nr(() => {
		n.current ? n.current = !1 : (!r.current || t.some((e, t) => !Object.is(e, r[t]))) && e(), r.current = t;
	}, t);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/selection/useSelectableCollection.mjs
function bf(e) {
	let { selectionManager: t, keyboardDelegate: n, ref: r, autoFocus: i = !1, shouldFocusWrap: a = !1, disallowEmptySelection: o = !1, disallowSelectAll: s = !1, escapeKeyBehavior: c = "clearSelection", selectOnFocus: l = t.selectionBehavior === "replace", disallowTypeAhead: u = !1, shouldUseVirtualFocus: d, allowsTabNavigation: f = !1, scrollRef: p = r, linkBehavior: m = "action", UNSTABLE_focusOnEntry: h } = e, { direction: g } = Li(), v = Ia(), y = (e, n, i) => {
		if (n != null) {
			if (t.isLink(n) && m === "selection" && l && !sf(e)) {
				(0, Jo.flushSync)(() => {
					t.setFocusedKey(n, i);
				});
				let a = cf(r, n), o = t.getItemProps(n);
				if (a) {
					v.open(a, e, o.href, o.routerOptions);
					return;
				}
				return !1;
			}
			if (t.setFocusedKey(n, i), t.isLink(n) && m === "override") return !1;
			if (e.shiftKey && t.selectionMode === "multiple") {
				t.extendSelection(n);
				return;
			}
			if (l && !sf(e)) {
				t.replaceSelection(n);
				return;
			}
		}
		return !1;
	}, b = (e) => {
		if (n.getKeyBelow) {
			let r = t.focusedKey == null ? n.getFirstKey?.() : n.getKeyBelow?.(t.focusedKey);
			if (r == null && a && (r = n.getFirstKey?.(t.focusedKey)), r != null) {
				y(e, r);
				return;
			}
		}
		return !1;
	}, x = (e) => {
		if (n.getKeyAbove) {
			let r = t.focusedKey == null ? n.getLastKey?.() : n.getKeyAbove?.(t.focusedKey);
			if (r == null && a && (r = n.getLastKey?.(t.focusedKey)), r != null) {
				y(e, r);
				return;
			}
		}
		return !1;
	}, S = (e) => {
		if (n.getFirstKey) {
			if (t.focusedKey === null && e.shiftKey) return !1;
			let r = n.getFirstKey(t.focusedKey, uc(e));
			if (t.setFocusedKey(r), r != null) {
				if (uc(e) && e.shiftKey && t.selectionMode === "multiple") {
					t.extendSelection(r);
					return;
				}
				if (l) {
					t.replaceSelection(r);
					return;
				}
			}
		}
		return !1;
	}, C = (e) => {
		if (n.getKeyLeftOf) {
			let r = t.focusedKey == null ? n.getFirstKey?.() : n.getKeyLeftOf?.(t.focusedKey);
			if (r == null && a && (r = g === "rtl" ? n.getFirstKey?.(t.focusedKey) : n.getLastKey?.(t.focusedKey)), r != null) {
				y(e, r, g === "rtl" ? "first" : "last");
				return;
			}
		}
		return !1;
	}, w = (e) => {
		if (n.getKeyRightOf) {
			let r = t.focusedKey == null ? n.getFirstKey?.() : n.getKeyRightOf?.(t.focusedKey);
			if (r == null && a && (r = g === "rtl" ? n.getLastKey?.(t.focusedKey) : n.getFirstKey?.(t.focusedKey)), r != null) {
				y(e, r, g === "rtl" ? "last" : "first");
				return;
			}
		}
		return !1;
	}, T = (e) => {
		if (n.getLastKey) {
			if (t.focusedKey === null && e.shiftKey) return !1;
			let r = n.getLastKey(t.focusedKey, uc(e));
			if (t.setFocusedKey(r), r != null) {
				if (uc(e) && e.shiftKey && t.selectionMode === "multiple") {
					t.extendSelection(r);
					return;
				}
				if (l) {
					t.replaceSelection(r);
					return;
				}
			}
		}
		return !1;
	}, ee = (e) => {
		if (n.getKeyPageBelow && t.focusedKey != null) {
			let r = n.getKeyPageBelow(t.focusedKey);
			if (r != null) return y(e, r);
		}
		return !1;
	}, E = (e) => {
		if (n.getKeyPageAbove && t.focusedKey != null) {
			let r = n.getKeyPageAbove(t.focusedKey);
			if (r != null) return y(e, r);
		}
		return !1;
	}, te = () => {
		if (t.selectionMode === "multiple" && s !== !0) {
			t.selectAll();
			return;
		}
		return !1;
	}, D = () => {
		if (c === "clearSelection" && !o && t.selectedKeys.size !== 0) {
			t.clearSelection();
			return;
		}
		return !1;
	}, O = () => {
		if (!f && r.current) {
			let e = Ul(r.current, { tabbable: !0 }), t, n;
			do
				n = e.lastChild(), n && (t = n);
			while (n);
			let i = ia();
			t && (!oa(t) || i && !ma(i)) && Wi(t);
		}
		return {
			shouldContinuePropagation: !0,
			shouldPreventDefault: !1
		};
	}, ne = () => (!f && r.current && r.current.focus(), {
		shouldContinuePropagation: !0,
		shouldPreventDefault: !1
	}), re = (e, t) => ({
		[wa() ? e + "+Shift+Alt" : e + "+Shift+Control"]: t,
		[e + "+Shift"]: t,
		[wa() ? e + "+Alt" : e + "+Control"]: t,
		[e]: t
	}), { keyboardProps: ie } = Mo({
		shortcuts: {
			...re("ArrowDown", b),
			...re("ArrowUp", x),
			...re("ArrowLeft", C),
			...re("ArrowRight", w),
			...re("PageDown", ee),
			...re("PageUp", E)
		},
		allowRepeats: !0
	}), { keyboardProps: ae } = Mo({ shortcuts: {
		...re("Home", S),
		...re("End", T),
		"Mod+A": te,
		Escape: D,
		Tab: O,
		"Tab+Shift": ne
	} }), oe = (0, _.useRef)({
		top: 0,
		left: 0
	});
	pc(p, "scroll", () => {
		oe.current = {
			top: p.current?.scrollTop ?? 0,
			left: p.current?.scrollLeft ?? 0
		};
	});
	let se = (e) => {
		if (t.isFocused) {
			P(e.currentTarget, F(e)) || t.setFocused(!1);
			return;
		}
		if (!P(e.currentTarget, F(e))) return;
		let i = oo();
		t.setFocused(!0);
		let a = (e) => {
			e != null && (t.setFocusedKey(e), l && !t.isSelected(e) && t.replaceSelection(e));
		};
		if (h && (i === "keyboard" || i === "virtual")) a(h === "first" ? n.getFirstKey?.() : n.getLastKey?.());
		else if (t.focusedKey == null) {
			let r = e.relatedTarget;
			r && e.currentTarget.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING ? a(t.lastSelectedKey ?? n.getLastKey?.()) : a(t.firstSelectedKey ?? n.getFirstKey?.());
		} else p.current && (p.current.scrollTop = oe.current.top, p.current.scrollLeft = oe.current.left);
		if (t.focusedKey != null && p.current) {
			let e = cf(r, t.focusedKey);
			e instanceof HTMLElement && (!oa(e) && !d && Wi(e), (i === "keyboard" || h && i === "virtual") && hf(e, { containingElement: r.current }));
		}
	}, ce = (e) => {
		P(e.currentTarget, e.relatedTarget) || t.setFocused(!1);
	}, le = (0, _.useRef)(!1);
	pc(r, ac, d ? (e) => {
		let { detail: n } = e;
		e.stopPropagation(), t.setFocused(!0), n?.focusStrategy === "first" && (le.current = !0);
	} : void 0);
	let ue = n.getFirstKey?.() ?? null;
	yf(() => {
		if (le.current) {
			if (ue == null) {
				let e = ia();
				oc(r.current), cc(e, null), t.collection.size > 0 && (le.current = !1);
			} else t.setFocusedKey(ue), le.current = !1;
		}
	}, [ue, t.collection.size]), yf(() => {
		t.collection.size > 0 && (le.current = !1);
	}, [t.focusedKey]), pc(r, ic, d ? (e) => {
		e.stopPropagation(), t.setFocused(!1), e.detail?.clearFocusKey && t.setFocusedKey(null);
	} : void 0);
	let de = (0, _.useRef)(i), fe = (0, _.useRef)(!1);
	(0, _.useEffect)(() => {
		if (de.current) {
			let e = null;
			i === "first" && (e = n.getFirstKey?.() ?? null), i === "last" && (e = n.getLastKey?.() ?? null);
			let a = t.selectedKeys;
			if (a.size) {
				for (let n of a) if (t.canSelectItem(n)) {
					e = n;
					break;
				}
			}
			t.setFocused(!0), t.setFocusedKey(e), e != null && l && !a.size && t.canSelectItem(e) && t.replaceSelection(e), e == null && !d && r.current && _o(r.current), t.collection.size > 0 && (de.current = !1, fe.current = !0);
		}
	});
	let pe = (0, _.useRef)(t.focusedKey), me = (0, _.useRef)(null);
	(0, _.useEffect)(() => {
		if (t.isFocused && t.focusedKey != null && (t.focusedKey !== pe.current || fe.current) && p.current && r.current) {
			let e = oo(), n = cf(r, t.focusedKey);
			if (!(n instanceof HTMLElement)) return;
			(e === "keyboard" || fe.current) && (me.current && cancelAnimationFrame(me.current), me.current = requestAnimationFrame(() => {
				p.current && (pf(p.current, n), e !== "virtual" && hf(n, { containingElement: r.current }));
			}));
		}
		!d && t.isFocused && t.focusedKey == null && pe.current != null && r.current && _o(r.current), pe.current = t.focusedKey, fe.current = !1;
	}), (0, _.useEffect)(() => () => {
		me.current && cancelAnimationFrame(me.current);
	}, []), pc(r, "react-aria-focus-scope-restore", (e) => {
		e.preventDefault(), t.setFocused(!0);
	});
	let he = {
		...ii(ae, ie),
		onFocus: se,
		onBlur: ce,
		onMouseDown(e) {
			p.current === F(e) && e.preventDefault();
		}
	}, { typeSelectProps: ge } = _f({
		keyboardDelegate: n,
		selectionManager: t
	});
	u || (he = ii(ge, he));
	let _e;
	d || (_e = t.focusedKey == null ? 0 : -1);
	let ve = uf(t.collection);
	return { collectionProps: ii(he, {
		tabIndex: _e,
		"data-collection": ve
	}) };
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/selection/DOMLayoutDelegate.mjs
var xf = class {
	constructor(e) {
		this.ref = e;
	}
	getItemRect(e) {
		let t = this.ref.current;
		if (!t) return null;
		let n = e == null ? null : cf(this.ref, e);
		if (!n) return null;
		let r = t.getBoundingClientRect(), i = n.getBoundingClientRect();
		return {
			x: i.left - r.left - t.clientLeft + t.scrollLeft,
			y: i.top - r.top - t.clientTop + t.scrollTop,
			width: i.width,
			height: i.height
		};
	}
	getContentSize() {
		let e = this.ref.current;
		return {
			width: e?.scrollWidth ?? 0,
			height: e?.scrollHeight ?? 0
		};
	}
	getVisibleRect() {
		let e = this.ref.current;
		return {
			x: e?.scrollLeft ?? 0,
			y: e?.scrollTop ?? 0,
			width: e?.clientWidth ?? 0,
			height: e?.clientHeight ?? 0
		};
	}
}, Sf = class {
	constructor(...e) {
		if (e.length === 1) {
			let t = e[0];
			this.collection = t.collection, this.ref = t.ref, this.collator = t.collator, this.disabledKeys = t.disabledKeys || /* @__PURE__ */ new Set(), this.disabledBehavior = t.disabledBehavior || "all", this.orientation = t.orientation || "vertical", this.direction = t.direction, this.layout = t.layout || "stack", this.layoutDelegate = t.layoutDelegate || new xf(t.ref);
		} else this.collection = e[0], this.disabledKeys = e[1], this.ref = e[2], this.collator = e[3], this.layout = "stack", this.orientation = "vertical", this.disabledBehavior = "all", this.layoutDelegate = new xf(this.ref);
		this.layout === "stack" && this.orientation === "vertical" && (this.getKeyLeftOf = void 0, this.getKeyRightOf = void 0);
	}
	isDisabled(e) {
		return this.disabledBehavior === "all" && (e.props?.isDisabled || this.disabledKeys.has(e.key)) && e.props?.disabledBehavior !== "selection";
	}
	findNextNonDisabled(e, t, n = !1) {
		let r = e;
		for (; r != null;) {
			let e = this.collection.getItem(r);
			if (e?.type === "item" && (n || !this.isDisabled(e))) return r;
			r = t(r);
		}
		return null;
	}
	getNextKey(e, t) {
		let n = e;
		return n = this.collection.getKeyAfter(n), this.findNextNonDisabled(n, (e) => this.collection.getKeyAfter(e), t?.includeDisabled);
	}
	getPreviousKey(e, t) {
		let n = e;
		return n = this.collection.getKeyBefore(n), this.findNextNonDisabled(n, (e) => this.collection.getKeyBefore(e), t?.includeDisabled);
	}
	findKey(e, t, n) {
		let r = e, i = this.layoutDelegate.getItemRect(r);
		if (!i || r == null) return null;
		let a = i;
		do {
			if (r = t(r), r == null) break;
			i = this.layoutDelegate.getItemRect(r);
		} while (i && n(a, i) && r != null);
		return r;
	}
	isSameRow(e, t) {
		return e.y === t.y || e.x !== t.x;
	}
	isSameColumn(e, t) {
		return e.x === t.x || e.y !== t.y;
	}
	isReversed(e) {
		let t = this.getNextKey(e), n = cf(this.ref, e);
		if (t != null) {
			let e = cf(this.ref, t);
			return !n || !e ? !1 : n.getBoundingClientRect().top > e.getBoundingClientRect().top;
		}
		let r = this.getPreviousKey(e);
		if (r != null) {
			let e = cf(this.ref, r);
			return !n || !e ? !1 : e.getBoundingClientRect().top > n.getBoundingClientRect().top;
		}
		return !1;
	}
	getKeyBelow(e, t) {
		return this.layout === "grid" && this.orientation === "vertical" ? this.findKey(e, (e) => this.getNextKey(e, t), this.isSameRow) : this.orientation === "vertical" && this.isReversed(e) ? this.getPreviousKey(e, t) : this.getNextKey(e, t);
	}
	getKeyAbove(e, t) {
		return this.layout === "grid" && this.orientation === "vertical" ? this.findKey(e, (e) => this.getPreviousKey(e, t), this.isSameRow) : this.orientation === "vertical" && this.isReversed(e) ? this.getNextKey(e, t) : this.getPreviousKey(e, t);
	}
	getNextColumn(e, t, n) {
		return t ? this.getPreviousKey(e, n) : this.getNextKey(e, n);
	}
	getKeyRightOf(e, t) {
		let n = this.direction === "ltr" ? "getKeyRightOf" : "getKeyLeftOf";
		return this.layoutDelegate[n] ? (e = this.layoutDelegate[n](e), this.findNextNonDisabled(e, (e) => this.layoutDelegate[n](e), t?.includeDisabled)) : this.layout === "grid" ? this.orientation === "vertical" ? this.getNextColumn(e, this.direction === "rtl", t) : this.findKey(e, (e) => this.getNextColumn(e, this.direction === "rtl", t), this.isSameColumn) : this.orientation === "horizontal" ? this.getNextColumn(e, this.direction === "rtl", t) : null;
	}
	getKeyLeftOf(e, t) {
		let n = this.direction === "ltr" ? "getKeyLeftOf" : "getKeyRightOf";
		return this.layoutDelegate[n] ? (e = this.layoutDelegate[n](e), this.findNextNonDisabled(e, (e) => this.layoutDelegate[n](e), t?.includeDisabled)) : this.layout === "grid" ? this.orientation === "vertical" ? this.getNextColumn(e, this.direction === "ltr", t) : this.findKey(e, (e) => this.getNextColumn(e, this.direction === "ltr", t), this.isSameColumn) : this.orientation === "horizontal" ? this.getNextColumn(e, this.direction === "ltr", t) : null;
	}
	getFirstKey() {
		let e = this.collection.getFirstKey();
		return this.findNextNonDisabled(e, (e) => this.collection.getKeyAfter(e));
	}
	getLastKey() {
		let e = this.collection.getLastKey();
		return this.findNextNonDisabled(e, (e) => this.collection.getKeyBefore(e));
	}
	getKeyPageAbove(e) {
		let t = this.ref.current, n = this.layoutDelegate.getItemRect(e);
		if (!n) return null;
		let r = this.isReversed(e);
		if (t && !Zl(t)) return this.getFirstKey();
		let i = e;
		if (this.orientation === "horizontal") {
			let e = Math.max(0, n.x + n.width - this.layoutDelegate.getVisibleRect().width);
			for (; n && n.x > e && i != null;) i = this.getKeyAbove(i), n = i == null ? null : this.layoutDelegate.getItemRect(i);
		} else {
			let e = this.layoutDelegate.getVisibleRect(), t = r ? n.y - e.height : Math.max(0, n.y + n.height - e.height);
			for (; n && n.y > t && i != null;) i = this.getKeyAbove(i), n = i == null ? null : this.layoutDelegate.getItemRect(i);
		}
		return i ?? (r ? this.getLastKey() : this.getFirstKey());
	}
	getKeyPageBelow(e) {
		let t = this.ref.current, n = this.layoutDelegate.getItemRect(e);
		if (!n) return null;
		let r = this.isReversed(e);
		if (t && !Zl(t)) return this.getLastKey();
		let i = e;
		if (this.orientation === "horizontal") {
			let e = Math.min(this.layoutDelegate.getContentSize().width, n.x - n.width + this.layoutDelegate.getVisibleRect().width);
			for (; n && n.x < e && i != null;) i = this.getKeyBelow(i), n = i == null ? null : this.layoutDelegate.getItemRect(i);
		} else {
			let e = Math.min(this.layoutDelegate.getContentSize().height, n.y - n.height + this.layoutDelegate.getVisibleRect().height);
			for (; n && n.y < e && i != null;) i = this.getKeyBelow(i), n = i == null ? null : this.layoutDelegate.getItemRect(i);
		}
		return i ?? (r ? this.getFirstKey() : this.getLastKey());
	}
	getKeyForSearch(e, t) {
		if (!this.collator) return null;
		let n = this.collection, r = t || this.getFirstKey();
		for (; r != null;) {
			let t = n.getItem(r);
			if (!t) return null;
			let i = t.textValue.slice(0, e.length);
			if (t.textValue && this.collator.compare(i, e) === 0) return r;
			r = this.getNextKey(r);
		}
		return null;
	}
}, Cf = /* @__PURE__ */ new Map();
function wf(e) {
	let { locale: t } = Li(), n = t + (e ? Object.entries(e).sort((e, t) => e[0] < t[0] ? -1 : 1).join() : "");
	if (Cf.has(n)) return Cf.get(n);
	let r = new Intl.Collator(t, e);
	return Cf.set(n, r), r;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/selection/useSelectableList.mjs
function Tf(e) {
	let { selectionManager: t, collection: n, disabledKeys: r, ref: i, keyboardDelegate: a, layoutDelegate: o, orientation: s } = e, c = wf({
		usage: "search",
		sensitivity: "base"
	}), l = t.disabledBehavior, u = (0, _.useMemo)(() => a || new Sf({
		collection: n,
		disabledKeys: r,
		disabledBehavior: l,
		ref: i,
		collator: c,
		layoutDelegate: o,
		orientation: s
	}), [
		a,
		o,
		n,
		r,
		i,
		c,
		l,
		s
	]), { collectionProps: d } = bf({
		...e,
		ref: i,
		selectionManager: t,
		keyboardDelegate: u
	});
	return { listProps: d };
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/menu/useMenu.mjs
function Ef(e, t, n) {
	let { shouldFocusWrap: r = !0, onKeyDown: i, onKeyUp: a, ...o } = e;
	!e["aria-label"] && e["aria-labelledby"];
	let s = Ti(e, { labelable: !0 }), { listProps: c } = Tf({
		...o,
		ref: n,
		selectionManager: t.selectionManager,
		collection: t.collection,
		disabledKeys: t.disabledKeys,
		shouldFocusWrap: r,
		linkBehavior: "override"
	});
	return of.set(t, {
		onClose: e.onClose,
		onAction: e.onAction,
		shouldUseVirtualFocus: e.shouldUseVirtualFocus
	}), { menuProps: ii(s, {
		onKeyDown: i,
		onKeyUp: a
	}, {
		role: "menu",
		...c,
		onKeyDown: (t) => {
			(t.key !== "Escape" || e.shouldUseVirtualFocus) && c.onKeyDown?.(t);
		}
	}) };
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/selection/useSelectableItem.mjs
function Df(e) {
	let { id: t, selectionManager: n, key: r, ref: i, shouldSelectOnPressUp: a, shouldUseVirtualFocus: o, focus: s, isDisabled: c, onAction: l, allowsDifferentPressOrigin: u, linkBehavior: d = "action" } = e, f = Ia();
	t = Zr(t);
	let p = (e) => {
		if (e.pointerType === "keyboard" && sf(e)) n.toggleSelection(r);
		else {
			if (n.selectionMode === "none") return;
			if (n.isLink(r)) {
				if (d === "selection" && i.current) {
					let t = n.getItemProps(r);
					f.open(i.current, e, t.href, t.routerOptions), n.setSelectedKeys(n.selectedKeys);
					return;
				}
				if (d === "override" || d === "none") return;
			}
			n.selectionMode === "single" ? n.isSelected(r) && !n.disallowEmptySelection ? n.toggleSelection(r) : n.replaceSelection(r) : e && e.shiftKey ? n.extendSelection(r) : n.selectionBehavior === "toggle" || e && (uc(e) || e.pointerType === "touch" || e.pointerType === "virtual") ? n.toggleSelection(r) : n.replaceSelection(r);
		}
	};
	(0, _.useEffect)(() => {
		r === n.focusedKey && n.isFocused && (o ? oc(i.current) : s ? s() : ia() !== i.current && i.current && _o(i.current));
	}, [
		i,
		r,
		n.focusedKey,
		n.childFocusStrategy,
		n.isFocused,
		o
	]), c ||= n.isDisabled(r);
	let m = {};
	!o && !c ? m = {
		tabIndex: r === n.focusedKey ? 0 : -1,
		onFocus(e) {
			F(e) === i.current && n.setFocusedKey(r);
		}
	} : c && (m.onMouseDown = (e) => {
		e.preventDefault();
	}), (0, _.useEffect)(() => {
		c && n.focusedKey === r && n.setFocusedKey(null);
	}, [
		n,
		c,
		r
	]);
	let h = n.isLink(r) && d === "override", g = l && e.UNSTABLE_itemBehavior === "action", v = n.isLink(r) && d !== "selection" && d !== "none", y = !c && n.canSelectItem(r) && !h && !g, b = (l || v) && !c, x = b && (n.selectionBehavior === "replace" ? !y : !y || n.isEmpty), S = b && y && n.selectionBehavior === "replace", C = x || S, w = (0, _.useRef)(null), T = C && y, ee = (0, _.useRef)(!1), E = (0, _.useRef)(!1), te = n.getItemProps(r), D = (e) => {
		l && (l(), i.current?.dispatchEvent(new CustomEvent("react-aria-item-action", { bubbles: !0 }))), v && i.current && f.open(i.current, e, te.href, te.routerOptions);
	}, O = { ref: i };
	a ? (O.onPressStart = (e) => {
		w.current = e.pointerType, ee.current = T, e.pointerType === "keyboard" && (!C || kf(e.key)) && p(e);
	}, u ? (O.onPressUp = x ? void 0 : (e) => {
		e.pointerType === "mouse" && y && p(e);
	}, O.onPress = x ? D : (e) => {
		e.pointerType !== "keyboard" && e.pointerType !== "mouse" && y && p(e);
	}) : O.onPress = (e) => {
		if (x || S && e.pointerType !== "mouse") {
			if (e.pointerType === "keyboard" && !Of(e.key)) return;
			D(e);
		} else e.pointerType !== "keyboard" && y && p(e);
	}) : (O.onPressStart = (e) => {
		w.current = e.pointerType, ee.current = T, E.current = x, y && (e.pointerType === "mouse" && !x || e.pointerType === "keyboard" && (!b || kf(e.key))) && p(e);
	}, O.onPress = (e) => {
		(e.pointerType === "touch" || e.pointerType === "pen" || e.pointerType === "virtual" || e.pointerType === "keyboard" && C && Of(e.key) || e.pointerType === "mouse" && E.current) && (C ? D(e) : y && p(e));
	});
	let ne = df(n.collection);
	if (m["data-collection"] = ne, m["data-key"] = r, O.preventFocusOnPress = o, o && (O = ii(O, {
		onPressStart(e) {
			e.pointerType !== "touch" && (n.setFocused(!0), n.setFocusedKey(r));
		},
		onPress(e) {
			e.pointerType === "touch" && (n.setFocused(!0), n.setFocusedKey(r));
		}
	})), te) for (let e of [
		"onPressStart",
		"onPressEnd",
		"onPressChange",
		"onPress",
		"onPressUp",
		"onClick"
	]) te[e] && (O[e] = Mr(O[e], te[e]));
	let { pressProps: re, isPressed: ie } = es(O), ae = S ? (e) => {
		w.current === "mouse" && (e.stopPropagation(), e.preventDefault(), D(e));
	} : void 0, { longPressProps: oe } = tf({
		isDisabled: !T,
		onLongPress(e) {
			e.pointerType === "touch" && (p(e), n.setSelectionBehavior("toggle"));
		}
	}), se = (e) => {
		w.current === "touch" && ee.current && e.preventDefault();
	}, ce = d !== "none" && n.isLink(r) ? (e) => {
		Ra.isOpening || e.preventDefault();
	} : void 0, le = ii(m, y || x || o && !c ? re : {}, T ? oe : {}, {
		onDoubleClick: ae,
		onDragStartCapture: se,
		onClick: ce,
		id: t
	}, o ? { onMouseDown: (e) => e.preventDefault() } : void 0), ue = (e) => {
		let t = e;
		for (; t && t !== i.current;) {
			let e = t.getAttribute("data-collection");
			if (e != null) return e !== ne;
			t = t.parentElement;
		}
		return ma(e);
	}, de = le.onPointerDown;
	le.onPointerDown = (e) => {
		let t = F(e);
		if (t && t !== i.current && ue(t)) {
			e.stopPropagation();
			return;
		}
		de?.(e);
	};
	let fe = le.onMouseDown;
	return le.onMouseDown = (e) => {
		let t = F(e);
		if (t && t !== i.current && ue(t)) {
			e.stopPropagation();
			return;
		}
		fe?.(e);
	}, {
		itemProps: le,
		isPressed: ie,
		isSelected: n.isSelected(r),
		isFocused: n.isFocused && n.focusedKey === r,
		isDisabled: c,
		allowsSelection: y,
		hasAction: C
	};
}
function Of(e) {
	return e === "Enter";
}
function kf(e) {
	return e === " ";
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/collections/getChildNodes.mjs
function Af(e, t) {
	return typeof t.getChildren == "function" ? t.getChildren(e.key) : e.childNodes;
}
function jf(e) {
	return Mf(e, 0);
}
function Mf(e, t) {
	if (t < 0) return;
	let n = 0;
	for (let r of e) {
		if (n === t) return r;
		n++;
	}
}
function Nf(e, t, n) {
	if (t.parentKey === n.parentKey) return t.index - n.index;
	let r = [...Pf(e, t), t], i = [...Pf(e, n), n], a = r.slice(0, i.length).findIndex((e, t) => e !== i[t]);
	return a === -1 ? r.findIndex((e) => e === n) >= 0 ? 1 : (i.findIndex((e) => e === t), -1) : (t = r[a], n = i[a], t.index - n.index);
}
function Pf(e, t) {
	let n = [], r = t;
	for (; r?.parentKey != null;) r = e.getItem(r.parentKey), r && n.unshift(r);
	return n;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/collections/getItemCount.mjs
var Ff = /* @__PURE__ */ new WeakMap();
function If(e) {
	let t = Ff.get(e);
	if (t != null) return t;
	let n = 0, r = (t) => {
		for (let i of t) i.type === "section" ? r(Af(i, e)) : i.type === "item" && n++;
	};
	return r(e), Ff.set(e, n), n;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/menu/useMenuItem.mjs
function Lf(e, t, n) {
	let { id: r, key: i, closeOnSelect: a, shouldCloseOnSelect: o, isVirtualized: s, "aria-haspopup": c, onPressStart: l, onPressUp: u, onPress: d, onPressChange: f, onPressEnd: p, onClick: m, onHoverStart: h, onHoverChange: g, onHoverEnd: v, onKeyDown: y, onKeyUp: b, onFocus: x, onFocusChange: S, onBlur: C, selectionManager: w = t.selectionManager } = e, T = !!c, ee = T && e["aria-expanded"] === "true", E = e.isDisabled ?? w.isDisabled(i), te = e.isSelected ?? w.isSelected(i), D = of.get(t), O = t.collection.getItem(i), ne = e.onClose || D.onClose, re = Ia(), ie = () => {
		if (!T && (O?.props?.onAction ? O.props.onAction() : e.onAction && e.onAction(i), D.onAction)) {
			let e = D.onAction;
			e(i, O?.value);
		}
	}, ae = "menuitem";
	T || (w.selectionMode === "single" ? ae = "menuitemradio" : w.selectionMode === "multiple" && (ae = "menuitemcheckbox"));
	let oe = $r(), se = $r(), ce = $r(), le = {
		id: r,
		"aria-disabled": E || void 0,
		role: ae,
		"aria-label": e["aria-label"],
		"aria-labelledby": oe,
		"aria-describedby": [
			e["aria-describedby"],
			se,
			ce
		].filter(Boolean).join(" ") || void 0,
		"aria-controls": e["aria-controls"],
		"aria-haspopup": c,
		"aria-expanded": e["aria-expanded"]
	};
	if (w.selectionMode !== "none" && !T && (le["aria-checked"] = te), s) {
		let e = Number(O?.index);
		le["aria-posinset"] = Number.isNaN(e) ? void 0 : e + 1, le["aria-setsize"] = If(t.collection);
	}
	let ue = (0, _.useRef)(!1), de = (e) => {
		f?.(e), ue.current = e;
	}, fe = (0, _.useRef)(null), pe = (e) => {
		e.pointerType !== "keyboard" && (fe.current = { pointerType: e.pointerType }), e.pointerType === "mouse" && (ue.current || e.target.click()), u?.(e);
	}, me = (e) => {
		m?.(e), ie(), Ha(e, re, O.props.href, O?.props.routerOptions);
		let t = fe.current?.pointerType === "keyboard" ? fe.current?.key === "Enter" || w.selectionMode === "none" || w.isLink(i) : w.selectionMode !== "multiple" || w.isLink(i);
		t = o ?? a ?? t, ne && !T && t && ne(), fe.current = null;
	}, { itemProps: he, isFocused: ge } = Df({
		id: r,
		selectionManager: w,
		key: i,
		ref: n,
		shouldSelectOnPressUp: !0,
		allowsDifferentPressOrigin: !0,
		linkBehavior: "none",
		shouldUseVirtualFocus: D.shouldUseVirtualFocus
	}), { pressProps: _e, isPressed: ve } = es({
		onPressStart: l,
		onPress: d,
		onPressUp: pe,
		onPressChange: de,
		onPressEnd: p,
		isDisabled: E
	}), { hoverProps: ye } = gs({
		isDisabled: E,
		onHoverStart(e) {
			!ao() && !(ee && c) && (w.setFocused(!0), w.setFocusedKey(i)), h?.(e);
		},
		onHoverChange: g,
		onHoverEnd: v
	}), { keyboardProps: be } = Mo({
		shortcuts: {
			" ": (e) => {
				fe.current = {
					pointerType: "keyboard",
					key: " "
				}, F(e).click(), so("keyboard");
			},
			Enter: (e) => {
				fe.current = {
					pointerType: "keyboard",
					key: "Enter"
				};
				let t = F(e);
				if (t.tagName !== "A") {
					t.click(), so("keyboard");
					return;
				}
				return so("keyboard"), {
					shouldPreventDefault: !1,
					shouldContinuePropagation: !1
				};
			}
		},
		onKeyDown: y,
		onKeyUp: b
	}), { focusableProps: xe } = Io({
		onBlur: C,
		onFocus: x,
		onFocusChange: S
	}, n), k = Ti(O?.props);
	delete k.id;
	let Se = Va(O?.props);
	return {
		menuItemProps: {
			...le,
			...ii(k, Se, T ? {
				onFocus: he.onFocus,
				"data-collection": he["data-collection"],
				"data-key": he["data-key"]
			} : he, _e, ye, be, xe, D.shouldUseVirtualFocus || T ? { onMouseDown: (e) => e.preventDefault() } : void 0, E ? void 0 : { onClick: me }),
			tabIndex: he.tabIndex != null && ee && !D.shouldUseVirtualFocus ? -1 : he.tabIndex
		},
		labelProps: { id: oe },
		descriptionProps: { id: se },
		keyboardShortcutProps: { id: ce },
		isFocused: ge,
		isFocusVisible: ge && w.isFocused && ao() && !ee,
		isSelected: te,
		isPressed: ve,
		isDisabled: E
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/menu/useMenuSection.mjs
function Rf(e) {
	let { heading: t, "aria-label": n } = e, r = Zr();
	return {
		itemProps: { role: "presentation" },
		headingProps: t ? {
			id: r,
			role: "presentation"
		} : {},
		groupProps: {
			role: "group",
			"aria-label": n,
			"aria-labelledby": t ? r : void 0
		}
	};
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/inertValue.mjs
function zf(e) {
	let t = _.version.split(".");
	return parseInt(t[0], 10) >= 19 ? e : e ? "true" : void 0;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useLoadMoreSentinel.mjs
function Bf(e, t) {
	let { collection: n, onLoadMore: r, scrollOffset: i = 1, direction: a = "end" } = e, o = (0, _.useRef)(null), s = L((e) => {
		for (let t of e) t.isIntersecting && r && r();
	});
	Nr(() => {
		if (t.current) {
			let e = 100 * i, n = a === "start" ? `${e}% 0px 0px 0px` : `0px ${e}% ${e}% ${e}%`;
			o.current = new IntersectionObserver(s, {
				root: Ql(t?.current),
				rootMargin: n
			}), o.current.observe(t.current);
		}
		return () => {
			o.current && o.current.disconnect();
		};
	}, [
		n,
		t,
		i,
		a
	]);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/selection/Selection.mjs
var Vf = class e extends Set {
	constructor(t, n, r) {
		super(t), t instanceof e ? (this.anchorKey = n ?? t.anchorKey, this.currentKey = r ?? t.currentKey) : (this.anchorKey = n ?? null, this.currentKey = r ?? null);
	}
}, Hf = class e {
	constructor(e, t, n) {
		this.collection = e, this.state = t, this.allowsCellSelection = n?.allowsCellSelection ?? !1, this._isSelectAll = null, this.layoutDelegate = n?.layoutDelegate || null, this.fullCollection = n?.fullCollection || null;
	}
	get selectionMode() {
		return this.state.selectionMode;
	}
	get disallowEmptySelection() {
		return this.state.disallowEmptySelection;
	}
	get selectionBehavior() {
		return this.state.selectionBehavior;
	}
	setSelectionBehavior(e) {
		this.state.setSelectionBehavior(e);
	}
	get isFocused() {
		return this.state.isFocused;
	}
	setFocused(e) {
		this.state.setFocused(e);
	}
	get focusedKey() {
		return this.state.focusedKey;
	}
	get childFocusStrategy() {
		return this.state.childFocusStrategy;
	}
	setFocusedKey(e, t) {
		(e == null || this.collection.getItem(e)) && this.state.setFocusedKey(e, t);
	}
	get selectedKeys() {
		return this.state.selectedKeys === "all" ? new Set(this.getSelectAllKeys()) : this.state.selectedKeys;
	}
	get rawSelection() {
		return this.state.selectedKeys;
	}
	isSelected(e) {
		if (this.state.selectionMode === "none") return !1;
		let t = this.getKey(e);
		return t == null ? !1 : this.state.selectedKeys === "all" ? this.canSelectItem(t) : this.state.selectedKeys.has(t);
	}
	get isEmpty() {
		return this.state.selectedKeys !== "all" && this.state.selectedKeys.size === 0;
	}
	get isSelectAll() {
		if (this.isEmpty) return !1;
		if (this.state.selectedKeys === "all") return !0;
		if (this._isSelectAll != null) return this._isSelectAll;
		let e = this.getSelectAllKeys(), t = this.state.selectedKeys;
		return this._isSelectAll = e.every((e) => t.has(e)), this._isSelectAll;
	}
	get firstSelectedKey() {
		let e = null;
		for (let t of this.state.selectedKeys) {
			let n = this.collection.getItem(t);
			(!e || n && Nf(this.collection, n, e) < 0) && (e = n);
		}
		return e?.key ?? null;
	}
	get lastSelectedKey() {
		let e = null;
		for (let t of this.state.selectedKeys) {
			let n = this.collection.getItem(t);
			(!e || n && Nf(this.collection, n, e) > 0) && (e = n);
		}
		return e?.key ?? null;
	}
	get disabledKeys() {
		return this.state.disabledKeys;
	}
	get disabledBehavior() {
		return this.state.disabledBehavior;
	}
	extendSelection(e) {
		if (this.selectionMode === "none") return;
		if (this.selectionMode === "single") {
			this.replaceSelection(e);
			return;
		}
		let t = this.getKey(e);
		if (t == null) return;
		let n;
		if (this.state.selectedKeys === "all") n = new Vf([t], t, t);
		else {
			let e = this.state.selectedKeys, r = e.anchorKey ?? t;
			n = new Vf(e, r, t);
			for (let i of this.getKeyRange(r, e.currentKey ?? t)) n.delete(i);
			for (let e of this.getKeyRange(t, r)) this.canSelectItem(e) && n.add(e);
		}
		this.state.setSelectedKeys(n);
	}
	getKeyRange(e, t) {
		let n = this.collection.getItem(e), r = this.collection.getItem(t);
		return n && r ? Nf(this.collection, n, r) <= 0 ? this.getKeyRangeInternal(e, t) : this.getKeyRangeInternal(t, e) : [];
	}
	getKeyRangeInternal(e, t) {
		if (this.layoutDelegate?.getKeyRange) return this.layoutDelegate.getKeyRange(e, t);
		let n = [], r = e;
		for (; r != null;) {
			let e = this.collection.getItem(r);
			if (e && (e.type === "item" || e.type === "cell" && this.allowsCellSelection) && n.push(r), r === t) return n;
			r = this.collection.getKeyAfter(r);
		}
		return [];
	}
	getKey(e) {
		let t = this.collection.getItem(e);
		if (!t || t.type === "cell" && this.allowsCellSelection) return e;
		for (; t && t.type !== "item" && t.parentKey != null;) t = this.collection.getItem(t.parentKey);
		return !t || t.type !== "item" ? null : t.key;
	}
	toggleSelection(e) {
		if (this.selectionMode === "none") return;
		if (this.selectionMode === "single" && !this.isSelected(e)) {
			this.replaceSelection(e);
			return;
		}
		let t = this.getKey(e);
		if (t == null) return;
		let n = new Vf(this.state.selectedKeys === "all" ? this.getSelectAllKeys() : this.state.selectedKeys);
		n.has(t) ? n.delete(t) : this.canSelectItem(t) && (n.add(t), n.anchorKey = t, n.currentKey = t), !(this.disallowEmptySelection && n.size === 0) && this.state.setSelectedKeys(n);
	}
	replaceSelection(e) {
		if (this.selectionMode === "none") return;
		let t = this.getKey(e);
		if (t == null) return;
		let n = this.canSelectItem(t) ? new Vf([t], t, t) : new Vf();
		this.state.setSelectedKeys(n);
	}
	setSelectedKeys(e) {
		if (this.selectionMode === "none") return;
		let t = new Vf();
		for (let n of e) {
			let e = this.getKey(n);
			if (e != null && (t.add(e), this.selectionMode === "single")) break;
		}
		this.state.setSelectedKeys(t);
	}
	getSelectAllKeys() {
		let e = this.fullCollection ?? this.collection, t = [], n = (r) => {
			for (; r != null;) {
				if (this.canSelectItemIn(r, e)) {
					let i = e.getItem(r);
					i?.type === "item" && t.push(r), i?.hasChildNodes && (this.allowsCellSelection || i.type !== "item") && n(jf(Af(i, e))?.key ?? null);
				}
				r = e.getKeyAfter(r);
			}
		};
		return n(e.getFirstKey()), t;
	}
	selectAll() {
		!this.isSelectAll && this.selectionMode === "multiple" && this.state.setSelectedKeys("all");
	}
	clearSelection() {
		!this.disallowEmptySelection && (this.state.selectedKeys === "all" || this.state.selectedKeys.size > 0) && this.state.setSelectedKeys(new Vf());
	}
	toggleSelectAll() {
		this.isSelectAll ? this.clearSelection() : this.selectAll();
	}
	select(e, t) {
		this.selectionMode !== "none" && (this.selectionMode === "single" ? this.isSelected(e) && !this.disallowEmptySelection ? this.toggleSelection(e) : this.replaceSelection(e) : this.selectionBehavior === "toggle" || t && (t.pointerType === "touch" || t.pointerType === "virtual") ? this.toggleSelection(e) : this.replaceSelection(e));
	}
	isSelectionEqual(e) {
		if (e === this.state.selectedKeys) return !0;
		let t = this.selectedKeys;
		if (e.size !== t.size) return !1;
		for (let n of e) if (!t.has(n)) return !1;
		for (let n of t) if (!e.has(n)) return !1;
		return !0;
	}
	canSelectItem(e) {
		return this.canSelectItemIn(e, this.collection);
	}
	canSelectItemIn(e, t) {
		if (this.state.selectionMode === "none" || this.state.disabledKeys.has(e)) return !1;
		let n = t.getItem(e);
		return !(!n || n?.props?.isDisabled || n.type === "cell" && !this.allowsCellSelection);
	}
	isDisabled(e) {
		let t = this.collection.getItem(e);
		return this.state.disabledBehavior === "all" && (this.state.disabledKeys.has(e) || !!t?.props?.isDisabled) && t?.props?.disabledBehavior !== "selection";
	}
	isLink(e) {
		return !!this.collection.getItem(e)?.props?.href;
	}
	getItemProps(e) {
		return this.collection.getItem(e)?.props;
	}
	withCollection(t) {
		return new e(t, this.state, {
			allowsCellSelection: this.allowsCellSelection,
			layoutDelegate: this.layoutDelegate || void 0,
			fullCollection: this.fullCollection ?? this.collection
		});
	}
}, Uf = class {
	constructor(e, { expandedKeys: t } = {}) {
		this.keyMap = /* @__PURE__ */ new Map(), this.firstKey = null, this.lastKey = null, this.iterable = e, t ||= /* @__PURE__ */ new Set();
		let n = (e) => {
			if (this.keyMap.set(e.key, e), e.childNodes && (e.type === "section" || t.has(e.key))) for (let t of e.childNodes) n(t);
		};
		for (let t of e) n(t);
		let r = null, i = 0;
		for (let [e, t] of this.keyMap) r ? (r.nextKey = e, t.prevKey = r.key) : (this.firstKey = e, t.prevKey = void 0), t.type === "item" && (t.index = i++), r = t, r.nextKey = void 0;
		this.lastKey = r?.key ?? null;
	}
	*[Symbol.iterator]() {
		yield* this.iterable;
	}
	get size() {
		return this.keyMap.size;
	}
	getKeys() {
		return this.keyMap.keys();
	}
	getKeyBefore(e) {
		let t = this.keyMap.get(e);
		return t ? t.prevKey ?? null : null;
	}
	getKeyAfter(e) {
		let t = this.keyMap.get(e);
		return t ? t.nextKey ?? null : null;
	}
	getFirstKey() {
		return this.firstKey;
	}
	getLastKey() {
		return this.lastKey;
	}
	getItem(e) {
		return this.keyMap.get(e) ?? null;
	}
	at(e) {
		let t = [...this.getKeys()];
		return this.getItem(t[e]);
	}
}, Wf = class {
	build(e, t) {
		return this.context = t, Gf(() => this.iterateCollection(e));
	}
	*iterateCollection(e) {
		let { children: t, items: n } = e;
		if (_.isValidElement(t) && t.type === _.Fragment) yield* this.iterateCollection({
			children: t.props.children,
			items: n
		});
		else if (typeof t == "function") {
			if (!n) throw Error("props.children was a function but props.items is missing");
			let e = 0;
			for (let r of n) yield* this.getFullNode({
				value: r,
				index: e
			}, { renderer: t }), e++;
		} else {
			let e = [];
			_.Children.forEach(t, (t) => {
				t && e.push(t);
			});
			let n = 0;
			for (let t of e) {
				let e = this.getFullNode({
					element: t,
					index: n
				}, {});
				for (let t of e) n++, yield t;
			}
		}
	}
	getKey(e, t, n, r) {
		if (e.key != null) return e.key;
		if (t.type === "cell" && t.key != null) return `${r}${t.key}`;
		let i = t.value;
		if (i != null) {
			let e = i.key ?? i.id;
			if (e == null) throw Error("No key found for item");
			return e;
		}
		return r ? `${r}.${t.index}` : `$.${t.index}`;
	}
	getChildState(e, t) {
		return { renderer: t.renderer || e.renderer };
	}
	*getFullNode(e, t, n, r) {
		if (_.isValidElement(e.element) && e.element.type === _.Fragment) {
			let i = [];
			_.Children.forEach(e.element.props.children, (e) => {
				i.push(e);
			});
			let a = e.index ?? 0;
			for (let e of i) yield* this.getFullNode({
				element: e,
				index: a++
			}, t, n, r);
			return;
		}
		let i = e.element;
		if (!i && e.value && t && t.renderer) {
			let n = this.cache.get(e.value);
			if (n && (!n.shouldInvalidate || !n.shouldInvalidate(this.context))) {
				n.index = e.index, n.parentKey = r ? r.key : null, yield n;
				return;
			}
			i = t.renderer(e.value);
		}
		if (_.isValidElement(i)) {
			let a = i.type;
			if (typeof a != "function" && typeof a.getCollectionNode != "function") {
				let e = i.type;
				throw Error(`Unknown element <${e}> in collection.`);
			}
			let o = a.getCollectionNode(i.props, this.context), s = e.index ?? 0, c = o.next();
			for (; !c.done && c.value;) {
				let a = c.value;
				e.index = s;
				let l = a.key ?? null;
				l ??= a.element ? null : this.getKey(i, e, t, n);
				let u = [...this.getFullNode({
					...a,
					key: l,
					index: s,
					wrapper: Kf(e.wrapper, a.wrapper)
				}, this.getChildState(t, a), n ? `${n}${i.key}` : i.key, r)];
				for (let t of u) {
					if (t.value = a.value ?? e.value ?? null, t.value && this.cache.set(t.value, t), e.type && t.type !== e.type) throw Error(`Unsupported type <${qf(t.type)}> in <${qf(r?.type ?? "unknown parent type")}>. Only <${qf(e.type)}> is supported.`);
					s++, yield t;
				}
				c = o.next(u);
			}
			return;
		}
		if (e.key == null || e.type == null) return;
		let a = this, o = {
			type: e.type,
			props: e.props,
			key: e.key,
			parentKey: r ? r.key : null,
			value: e.value ?? null,
			level: (r?.level ?? 0) + +(r?.type === "item"),
			index: e.index,
			rendered: e.rendered,
			textValue: e.textValue ?? "",
			"aria-label": e["aria-label"],
			wrapper: e.wrapper,
			shouldInvalidate: e.shouldInvalidate,
			hasChildNodes: e.hasChildNodes || !1,
			childNodes: Gf(function* () {
				if (!e.hasChildNodes || !e.childNodes) return;
				let n = 0;
				for (let r of e.childNodes()) {
					r.key != null && (r.key = `${o.key}${r.key}`);
					let e = a.getFullNode({
						...r,
						index: n
					}, a.getChildState(t, r), o.key, o);
					for (let t of e) n++, yield t;
				}
			})
		};
		yield o;
	}
	constructor() {
		this.cache = /* @__PURE__ */ new WeakMap();
	}
};
function Gf(e) {
	let t = [], n = null;
	return { *[Symbol.iterator]() {
		for (let e of t) yield e;
		n ||= e();
		for (let e of n) t.push(e), yield e;
	} };
}
function Kf(e, t) {
	if (e && t) return (n) => e(t(n));
	if (e) return e;
	if (t) return t;
}
function qf(e) {
	return e[0].toUpperCase() + e.slice(1);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/collections/useCollection.mjs
function Jf(e, t, n) {
	let r = (0, _.useMemo)(() => new Wf(), []), { children: i, items: a, collection: o } = e;
	return (0, _.useMemo)(() => o || t(r.build({
		children: i,
		items: a
	}, n)), [
		r,
		i,
		a,
		o,
		n,
		t
	]);
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/selection/useMultipleSelectionState.mjs
function Yf(e, t) {
	if (e.size !== t.size) return !1;
	for (let n of e) if (!t.has(n)) return !1;
	return !0;
}
function Xf(e) {
	let { selectionMode: t = "none", disallowEmptySelection: n = !1, allowDuplicateSelectionEvents: r, selectionBehavior: i = "toggle", disabledBehavior: a = "all" } = e, o = (0, _.useRef)(!1), [, s] = (0, _.useState)(!1), c = (0, _.useRef)(null), l = (0, _.useRef)(null), [, u] = (0, _.useState)(null), [d, f] = kc((0, _.useMemo)(() => Zf(e.selectedKeys), [e.selectedKeys]), (0, _.useMemo)(() => Zf(e.defaultSelectedKeys, new Vf()), [e.defaultSelectedKeys]), e.onSelectionChange), p = (0, _.useMemo)(() => e.disabledKeys ? new Set(e.disabledKeys) : /* @__PURE__ */ new Set(), [e.disabledKeys]), [m, h] = (0, _.useState)(i);
	i === "replace" && m === "toggle" && typeof d == "object" && d.size === 0 && h("replace");
	let g = (0, _.useRef)(i);
	return (0, _.useEffect)(() => {
		i !== g.current && (h(i), g.current = i);
	}, [i]), {
		selectionMode: t,
		disallowEmptySelection: n,
		selectionBehavior: m,
		setSelectionBehavior: h,
		get isFocused() {
			return o.current;
		},
		setFocused(e) {
			o.current = e, s(e);
		},
		get focusedKey() {
			return c.current;
		},
		get childFocusStrategy() {
			return l.current;
		},
		setFocusedKey(e, t = "first") {
			c.current = e, l.current = t, u(e);
		},
		selectedKeys: d,
		setSelectedKeys(e) {
			(r || !Yf(e, d)) && f(e);
		},
		disabledKeys: p,
		disabledBehavior: a
	};
}
function Zf(e, t) {
	return e ? e === "all" ? "all" : new Vf(e) : t;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-stately/dist/private/tree/useTreeState.mjs
function Qf(e) {
	let { onExpandedChange: t } = e, [n, r] = kc(e.expandedKeys ? new Set(e.expandedKeys) : void 0, e.defaultExpandedKeys ? new Set(e.defaultExpandedKeys) : /* @__PURE__ */ new Set(), t), i = Xf(e), a = (0, _.useMemo)(() => e.disabledKeys ? new Set(e.disabledKeys) : /* @__PURE__ */ new Set(), [e.disabledKeys]), o = Jf(e, (0, _.useCallback)((e) => new Uf(e, { expandedKeys: n }), [n]), null);
	return (0, _.useEffect)(() => {
		i.focusedKey != null && !o.getItem(i.focusedKey) && i.setFocusedKey(null);
	}, [o, i.focusedKey]), {
		collection: o,
		expandedKeys: n,
		disabledKeys: a,
		toggleKey: (e) => {
			r($f(n, e));
		},
		setExpandedKeys: r,
		selectionManager: new Hf(o, i)
	};
}
function $f(e, t) {
	let n = new Set(e);
	return n.has(t) ? n.delete(t) : n.add(t), n;
}
//#endregion
//#region ../../../../2026-10-01/task-18/node_modules/react-aria-components/dist/private/Menu.mjs
var ep = /*#__PURE__*/ (0, _.createContext)(null), tp = /*#__PURE__*/ (0, _.createContext)(null), R = /*#__PURE__*/ (0, _.createContext)(null), np = /*#__PURE__*/ (0, _.createContext)(null);
function rp(e) {
	let t = ld(e), n = (0, _.useRef)(null), { menuTriggerProps: r, menuProps: i } = af({
		...e,
		type: "menu"
	}, t, n), a = (0, _.useRef)(null);
	return vi() ? null : /*#__PURE__*/ _.createElement(si, { values: [
		[ep, {
			...i,
			ref: a
		}],
		[dd, t],
		[R, t],
		[id, {
			trigger: "MenuTrigger",
			triggerRef: n,
			scrollRef: a,
			placement: "bottom start",
			"aria-labelledby": i["aria-labelledby"],
			offset: e.trigger === "contextMenu" ? 0 : void 0
		}]
	] }, /*#__PURE__*/ _.createElement(Ju, {
		...r,
		ref: n,
		isPressed: t.isOpen
	}, e.children));
}
var ip = /*#__PURE__*/ (0, _.createContext)(null);
(class extends xs {
	static {
		this.type = "submenutrigger";
	}
	filter(e, t, n) {
		let r = e.getItem(this.firstChildKey);
		if (r && n(r.textValue, this)) {
			let n = this.clone();
			return t.addDescendants(n, e), n;
		}
		return null;
	}
});
var ap = /*#__PURE__*/ (0, _.forwardRef)(function(e, t) {
	return [e, t] = ui(e, t, ep), /*#__PURE__*/ _.createElement(Rs, { content: /*#__PURE__*/ _.createElement(Xs, e) }, (n) => /*#__PURE__*/ _.createElement(op, {
		props: e,
		collection: n,
		menuRef: t
	}));
});
function op({ props: e, collection: t, menuRef: n }) {
	[e, n] = ui(e, n, Ac);
	let { filter: r, ...i } = e, a = (0, _.useMemo)(() => r ? t.filter(r) : t, [t, r]), o = Qf({
		...e,
		collection: a,
		children: void 0
	}), s = (0, _.useContext)(R), { isVirtualized: c, CollectionRoot: l } = (0, _.useContext)(nc), { menuProps: u } = Ef({
		...e,
		isVirtualized: c,
		onClose: e.onClose || s?.close
	}, o, n), d = ci({
		...e,
		children: void 0,
		defaultClassName: "react-aria-Menu",
		values: { isEmpty: o.collection.size === 0 }
	}), f = null;
	o.collection.size === 0 && e.renderEmptyState && (f = /*#__PURE__*/ _.createElement("div", {
		role: "menuitem",
		style: { display: "contents" }
	}, e.renderEmptyState()));
	let p = Ti(e, { global: !0 });
	return /*#__PURE__*/ _.createElement(Cl, null, /*#__PURE__*/ _.createElement(mi.div, {
		...ii(p, d, u),
		ref: n,
		slot: e.slot || void 0,
		"data-empty": o.collection.size === 0 || void 0,
		onScroll: e.onScroll
	}, /*#__PURE__*/ _.createElement(si, { values: [
		[tp, o],
		[hd, { elementType: "div" }],
		[Qs, {
			name: "MenuSection",
			render: cp
		}],
		[ip, {
			parentMenuRef: n,
			shouldUseVirtualFocus: i?.shouldUseVirtualFocus
		}],
		[up, { shouldCloseOnSelect: e.shouldCloseOnSelect }],
		[Ac, null],
		[jc, null],
		[np, o.selectionManager],
		[R, s ?? ld({})]
	] }, /*#__PURE__*/ _.createElement(pd, null, /*#__PURE__*/ _.createElement(l, {
		collection: o.collection,
		persistedKeys: rc(o.selectionManager.focusedKey),
		scrollRef: n
	}))), f));
}
var sp = class extends Hf {
	constructor(e, t) {
		super(e.collection, t), this.parent = e;
	}
	get focusedKey() {
		return this.parent.focusedKey;
	}
	get isFocused() {
		return this.parent.isFocused;
	}
	setFocusedKey(e, t) {
		return this.parent.setFocusedKey(e, t);
	}
	setFocused(e) {
		this.parent.setFocused(e);
	}
	get childFocusStrategy() {
		return this.parent.childFocusStrategy;
	}
};
function cp(e, t, n, r = "react-aria-MenuSection") {
	let i = (0, _.useContext)(tp), { CollectionBranch: a } = (0, _.useContext)(nc), [o, s] = di(), { headingProps: c, groupProps: l } = Rf({
		heading: s,
		"aria-label": n.props["aria-label"] ?? void 0
	}), u = ci({
		...e,
		id: void 0,
		children: void 0,
		defaultClassName: r,
		className: n.props?.className,
		style: n.props?.style,
		values: void 0
	}), d = (0, _.useContext)(np), f = Xf(e), p = e.selectionMode == null ? d : new sp(d, f), m = li(up)?.shouldCloseOnSelect, h = Ti(e, { global: !0 });
	return delete h.id, /*#__PURE__*/ _.createElement(mi.section, {
		...ii(h, u, l),
		ref: t
	}, /*#__PURE__*/ _.createElement(si, { values: [
		[Mc, {
			...c,
			ref: o
		}],
		[np, p],
		[up, { shouldCloseOnSelect: e.shouldCloseOnSelect ?? m }]
	] }, /*#__PURE__*/ _.createElement(a, {
		collection: i.collection,
		parent: n
	})));
}
var lp = /*#__PURE__*/ qs(Es, cp), up = /*#__PURE__*/ (0, _.createContext)(null), dp = /*#__PURE__*/ Ks(Ts, function(e, t, n) {
	[e, t] = ui(e, t, up);
	let r = li(up)?.id, i = (0, _.useContext)(tp), a = ai(t), o = (0, _.useContext)(np), { isVirtualized: s } = (0, _.useContext)(nc), { menuItemProps: c, labelProps: l, descriptionProps: u, keyboardShortcutProps: d, ...f } = Lf({
		...e,
		id: r,
		key: n.key,
		selectionManager: o,
		isVirtualized: s
	}, i, a), { hoverProps: p, isHovered: m } = gs({ isDisabled: f.isDisabled }), h = ci({
		...e,
		id: void 0,
		children: n.rendered,
		defaultClassName: "react-aria-MenuItem",
		values: {
			...f,
			isHovered: m,
			isFocusVisible: f.isFocusVisible,
			selectionMode: o.selectionMode,
			selectionBehavior: o.selectionBehavior,
			hasSubmenu: !!e["aria-haspopup"],
			isOpen: e["aria-expanded"] === "true"
		}
	}), g = e.href ? mi.a : mi.div, v = Ti(e, { global: !0 });
	return delete v.id, delete v.onClick, /*#__PURE__*/ _.createElement(g, {
		...ii(v, h, c, p),
		ref: a,
		"data-disabled": f.isDisabled || void 0,
		"data-hovered": m || void 0,
		"data-focused": f.isFocused || void 0,
		"data-focus-visible": f.isFocusVisible || void 0,
		"data-pressed": f.isPressed || void 0,
		"data-selected": f.isSelected || void 0,
		"data-selection-mode": o.selectionMode === "none" ? void 0 : o.selectionMode,
		"data-has-submenu": !!e["aria-haspopup"] || void 0,
		"data-open": e["aria-expanded"] === "true" || void 0
	}, /*#__PURE__*/ _.createElement(si, { values: [
		[cd, { slots: {
			[oi]: l,
			label: l,
			description: u
		} }],
		[Pc, d],
		[md, { isSelected: f.isSelected }]
	] }, h.children));
});
Ks(ws, function(e, t, n) {
	let r = (0, _.useContext)(tp), { isLoading: i, onLoadMore: a, scrollOffset: o, ...s } = e, c = (0, _.useRef)(null);
	Bf((0, _.useMemo)(() => ({
		onLoadMore: a,
		collection: r?.collection,
		sentinelRef: c,
		scrollOffset: o
	}), [
		a,
		o,
		r?.collection
	]), c);
	let l = ci({
		...s,
		id: void 0,
		children: n.rendered,
		defaultClassName: "react-aria-MenuLoadingIndicator",
		values: void 0
	});
	return /*#__PURE__*/ _.createElement(_.Fragment, null, /*#__PURE__*/ _.createElement("div", {
		style: {
			position: "relative",
			width: 0,
			height: 0
		},
		inert: zf(!0)
	}, /*#__PURE__*/ _.createElement("div", {
		"data-testid": "loadMoreSentinel",
		ref: c,
		style: {
			position: "absolute",
			height: 1,
			width: 1
		}
	})), i && l.children && /*#__PURE__*/ _.createElement(_.Fragment, null, /*#__PURE__*/ _.createElement(mi.div, {
		...ii(Ti(e, { global: !0 }), { tabIndex: -1 }),
		...l,
		role: "menuitem",
		ref: t
	}, l.children)));
});
var fp = {
	trigger: "_trigger_61a49_1",
	name: "_name_61a49_16",
	who: "_who_61a49_20",
	demo: "_demo_61a49_21",
	popover: "_popover_61a49_26",
	menu: "_menu_61a49_33",
	section: "_section_61a49_39",
	header: "_header_61a49_48",
	item: "_item_61a49_53",
	chosen: "_chosen_61a49_71"
}, pp = [
	"simple",
	"guided",
	"books"
], mp = ["en", "hi"];
function hp(e) {
	let t = j(), n = (t) => {
		let [n, r] = String(t).split(":", 2);
		n === "ws" && r ? e.onSwitchWorkspace?.(r) : n === "co" && r ? e.onSwitchCompany?.(r) : n === "view" && (r === "simple" || r === "guided" || r === "books") ? e.onSetView(r) : n === "lang" && (r === "en" || r === "hi") ? e.onSetLanguage(r) : n === "lock" ? e.onLock() : n === "about" && e.onAbout();
	}, r = e.views ?? pp;
	return /* @__PURE__ */ (0, A.jsxs)(rp, { children: [/* @__PURE__ */ (0, A.jsxs)(vs, {
		className: [fp.trigger].join(" "),
		"aria-label": t("SH-06.open"),
		children: [/* @__PURE__ */ (0, A.jsxs)("span", {
			className: fp.name,
			children: [e.workspace.name, e.workspace.demo && /* @__PURE__ */ (0, A.jsxs)("span", {
				className: fp.demo,
				children: [" ", t("SH-06.demo")]
			})]
		}), /* @__PURE__ */ (0, A.jsx)("span", {
			className: fp.who,
			children: e.workspace.who
		})]
	}), /* @__PURE__ */ (0, A.jsx)(od, {
		className: [fp.popover].join(" "),
		placement: "top start",
		children: /* @__PURE__ */ (0, A.jsxs)(ap, {
			className: [fp.menu].join(" "),
			onAction: n,
			children: [
				e.onSwitchWorkspace && e.workspaces && e.workspaces.length > 1 && /* @__PURE__ */ (0, A.jsxs)(lp, {
					className: [fp.section].join(" "),
					children: [/* @__PURE__ */ (0, A.jsx)(Nc, {
						className: fp.header,
						children: t("SH-06.workspaces")
					}), e.workspaces.map((e) => /* @__PURE__ */ (0, A.jsxs)(dp, {
						id: `ws:${e.id}`,
						className: [fp.item].join(" "),
						children: [e.name, /* @__PURE__ */ (0, A.jsxs)("span", {
							className: fp.demo,
							children: [" ", e.demo ? t("SH-06.demo") : t("SH-06.real")]
						})]
					}, e.id))]
				}),
				e.onSwitchCompany && e.companies && e.companies.length > 0 && /* @__PURE__ */ (0, A.jsxs)(lp, {
					className: [fp.section].join(" "),
					children: [
						/* @__PURE__ */ (0, A.jsx)(Nc, {
							className: fp.header,
							children: t("SH-06.companies")
						}),
						e.companies.map((t) => /* @__PURE__ */ (0, A.jsx)(dp, {
							id: `co:${t.id}`,
							className: [fp.item, e.companyId === t.id ? fp.chosen : ""].join(" "),
							children: t.name
						}, t.id)),
						/* @__PURE__ */ (0, A.jsx)(dp, {
							id: "co:all",
							className: [fp.item, e.companyId === "all" ? fp.chosen : ""].join(" "),
							children: t("SH-06.companies.all")
						})
					]
				}),
				/* @__PURE__ */ (0, A.jsxs)(lp, {
					className: [fp.section].join(" "),
					children: [/* @__PURE__ */ (0, A.jsx)(Nc, {
						className: fp.header,
						children: t("SH-06.view")
					}), r.map((n) => /* @__PURE__ */ (0, A.jsx)(dp, {
						id: `view:${n}`,
						className: [fp.item, e.view === n ? fp.chosen : ""].join(" "),
						children: t(`SH-06.view.${n}`)
					}, n))]
				}),
				/* @__PURE__ */ (0, A.jsxs)(lp, {
					className: [fp.section].join(" "),
					children: [/* @__PURE__ */ (0, A.jsx)(Nc, {
						className: fp.header,
						children: t("SH-06.language")
					}), mp.map((n) => /* @__PURE__ */ (0, A.jsx)(dp, {
						id: `lang:${n}`,
						className: [fp.item, e.language === n ? fp.chosen : ""].join(" "),
						children: /* @__PURE__ */ (0, A.jsx)("span", {
							lang: n,
							children: t(`SH-06.language.${n}`)
						})
					}, n))]
				}),
				/* @__PURE__ */ (0, A.jsxs)(lp, {
					className: [fp.section].join(" "),
					children: [/* @__PURE__ */ (0, A.jsx)(dp, {
						id: "lock",
						className: [fp.item].join(" "),
						children: t("SH-06.lock")
					}), /* @__PURE__ */ (0, A.jsx)(dp, {
						id: "about",
						className: [fp.item].join(" "),
						children: t("SH-06.about")
					})]
				})
			]
		})
	})] });
}
var gp = {
	stack: "_stack_eo4ru_1",
	banner: "_banner_eo4ru_5",
	text: "_text_eo4ru_15",
	action: "_action_eo4ru_20"
}, _p = [
	"driving",
	"demo-clock",
	"read-only",
	"sending-closed",
	"jobs-paused",
	"update-needed",
	"no-connection"
], vp = {
	driving: "SH-03.driving.action",
	"read-only": "SH-03.read-only.action",
	"sending-closed": "SH-03.sending-closed.action",
	"update-needed": "SH-03.update-needed.action"
};
function yp({ item: e }) {
	let t = j(), n = vp[e.kind];
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: gp.banner,
		role: "status",
		children: [/* @__PURE__ */ (0, A.jsx)("span", {
			className: gp.text,
			children: t(`SH-03.${e.kind}`, e.values)
		}), e.action && n && /* @__PURE__ */ (0, A.jsx)(wr, {
			variant: "link",
			onClick: e.action.onPress,
			className: gp.action,
			children: t(n)
		})]
	});
}
function bp({ items: e }) {
	let t = [...e].sort((e, t) => _p.indexOf(e.kind) - _p.indexOf(t.kind));
	return t.length === 0 ? null : /* @__PURE__ */ (0, A.jsx)("div", {
		className: gp.stack,
		children: t.map((e) => /* @__PURE__ */ (0, A.jsx)(yp, { item: e }, e.kind))
	});
}
var xp = {
	sheet: "_sheet_1jt9z_1",
	top: "_top_1jt9z_12",
	kind: "_kind_1jt9z_21",
	back: "_back_1jt9z_25",
	close: "_close_1jt9z_26",
	title: "_title_1jt9z_31",
	body: "_body_1jt9z_39",
	actions: "_actions_1jt9z_47"
}, Sp = (0, _.createContext)({
	setPrimary: () => {},
	setClose: () => {},
	setAdjacent: () => {}
});
function Cp({ kind: e, position: t, title: n, back: r, onClose: i, onAdjacent: a, primary: o, actions: s, origin: c, corner: l, children: u }) {
	let d = j(), f = (0, _.useId)(), p = (0, _.useRef)(null), m = (0, _.useContext)(Sp), h = (0, _.useRef)(c);
	return h.current = c ?? h.current, (0, _.useEffect)(() => (p.current?.focus(), () => {
		h.current?.focus();
	}), []), (0, _.useEffect)(() => {
		p.current?.focus();
	}, [n]), (0, _.useEffect)(() => (m.setPrimary(o ?? null), m.setClose(i), m.setAdjacent(a ?? null), () => {
		m.setPrimary(null), m.setClose(null), m.setAdjacent(null);
	}), [
		m,
		o,
		i,
		a
	]), /* @__PURE__ */ (0, A.jsxs)("section", {
		className: [xp.sheet, "m-sheet"].join(" "),
		"aria-labelledby": f,
		"data-region": "sheet",
		children: [
			/* @__PURE__ */ (0, A.jsxs)("div", {
				className: xp.top,
				children: [
					/* @__PURE__ */ (0, A.jsx)("span", {
						className: xp.kind,
						children: r ? /* @__PURE__ */ (0, A.jsx)(wr, {
							variant: "link",
							onClick: r.onBack,
							className: xp.back,
							children: d("SHEET.back", { what: r.label })
						}) : t ? d("SHEET.position", {
							kind: e,
							index: t.index,
							total: t.total
						}) : e
					}),
					l,
					/* @__PURE__ */ (0, A.jsx)(wr, {
						variant: "link",
						onClick: i,
						className: xp.close,
						children: d("SHEET.close")
					})
				]
			}),
			/* @__PURE__ */ (0, A.jsx)("h2", {
				id: f,
				ref: p,
				tabIndex: -1,
				className: xp.title,
				children: n
			}),
			/* @__PURE__ */ (0, A.jsx)("div", {
				className: xp.body,
				children: u
			}),
			(o || s) && /* @__PURE__ */ (0, A.jsxs)("div", {
				className: xp.actions,
				children: [o && /* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "filled",
					onClick: o.onPress,
					disabled: o.disabled,
					children: o.label
				}), s]
			})
		]
	});
}
var wp = {
	frame: "_frame_17mz4_1",
	main: "_main_17mz4_8",
	pageCol: "_pageCol_17mz4_16",
	column: "_column_17mz4_25",
	wide: "_wide_17mz4_29",
	withSheet: "_withSheet_17mz4_32",
	page: "_page_17mz4_16",
	sheetCol: "_sheetCol_17mz4_45",
	narrow: "_narrow_17mz4_67"
};
//#endregion
//#region app/ui/src/app/Frame.tsx
function Tp(e) {
	let [t, n] = (0, _.useState)(!1);
	return (0, _.useEffect)(() => {
		let t = window.matchMedia(e), r = () => n(t.matches);
		return r(), t.addEventListener("change", r), () => t.removeEventListener("change", r);
	}, [e]), t;
}
function Ep(e) {
	return hr.some((t) => t === e);
}
function Dp({ shell: e, address: t, onNavigate: n, counts: r, menu: i, banners: a = [], ask: o, status: s, statusSimple: c, wide: l = !1, sheet: u, onHelp: d, children: f }) {
	let p = j(), m = Tp("(max-width: 1023px)"), h = (0, _.useRef)(null), g = (0, _.useRef)(null), v = (0, _.useRef)({
		primary: null,
		close: null,
		adjacent: null
	}), y = (0, _.useMemo)(() => ({
		setPrimary: (e) => {
			v.current.primary = e;
		},
		setClose: (e) => {
			v.current.close = e;
		},
		setAdjacent: (e) => {
			v.current.adjacent = e;
		}
	}), []), b = (0, _.useCallback)((e) => {
		let t = h.current;
		if (!t) return;
		let n = /* @__PURE__ */ new Set();
		for (let e of hr) t.querySelector(`[data-region="${e}"]`) && n.add(e);
		let r = (document.activeElement?.closest("[data-region]"))?.dataset.region, i = gr(Ep(r) ? r : null, n, e);
		if (!i) return;
		let a = t.querySelector(`[data-region="${i}"]`);
		if (!a) return;
		let o = a.querySelector("[data-region-entry]"), s = a.querySelector("input, button, a[href], summary, [tabindex=\"0\"], h2[tabindex=\"-1\"]");
		(o ?? s ?? a).focus();
	}, []), x = o.voice, S = x?.on === !0, C = Dr(x);
	(0, _.useEffect)(() => {
		let t = (t) => {
			let r = mr(t);
			if (r) switch (r.kind) {
				case "ask":
					t.preventDefault(), g.current?.focus();
					break;
				case "place": {
					let i = sr(e)[r.index];
					i && cr(e, i) && (t.preventDefault(), n({ place: i }));
					break;
				}
				case "escape":
					v.current.close && (t.preventDefault(), v.current.close());
					break;
				case "adjacent":
					v.current.adjacent && (t.preventDefault(), v.current.adjacent(r.delta));
					break;
				case "primary":
					pr(t, v.current.primary);
					break;
				case "region":
					t.preventDefault(), b(r.backwards);
					break;
				case "help":
					d && (t.preventDefault(), d(void 0, g.current));
					break;
				case "talk": r.phase === "start" ? S && (t.preventDefault(), C.start()) : C.end();
			}
		};
		return window.addEventListener("keydown", t), window.addEventListener("keyup", t), () => {
			window.removeEventListener("keydown", t), window.removeEventListener("keyup", t);
		};
	}, [
		e,
		n,
		b,
		d,
		S,
		C
	]);
	let w = e.kind === "desktop" && e.view === "simple";
	return /* @__PURE__ */ (0, A.jsx)(Sp.Provider, {
		value: y,
		children: /* @__PURE__ */ (0, A.jsxs)("div", {
			ref: h,
			className: [
				wp.frame,
				m ? wp.narrow : "",
				l ? wp.wide : "",
				u ? wp.withSheet : ""
			].filter(Boolean).join(" "),
			children: [/* @__PURE__ */ (0, A.jsx)(yr, {
				shell: e,
				address: t,
				onNavigate: n,
				counts: r,
				narrow: m,
				foot: /* @__PURE__ */ (0, A.jsx)(hp, { ...i })
			}), /* @__PURE__ */ (0, A.jsxs)("div", {
				className: wp.main,
				children: [/* @__PURE__ */ (0, A.jsxs)("div", {
					className: wp.pageCol,
					children: [
						/* @__PURE__ */ (0, A.jsx)("div", {
							className: wp.column,
							children: /* @__PURE__ */ (0, A.jsx)(bp, { items: a })
						}),
						/* @__PURE__ */ (0, A.jsx)("main", {
							className: [wp.page, wp.column].join(" "),
							tabIndex: -1,
							"aria-label": p("SH-01.region.page"),
							"data-region": "page",
							children: f
						}),
						/* @__PURE__ */ (0, A.jsxs)("div", {
							className: wp.column,
							children: [/* @__PURE__ */ (0, A.jsx)(Or, {
								ref: g,
								...o,
								hold: C,
								simple: w
							}), /* @__PURE__ */ (0, A.jsx)(jr, {
								status: s,
								view: e.view,
								onNavigate: n,
								simpleSentences: c
							})]
						})
					]
				}), u && /* @__PURE__ */ (0, A.jsx)("div", {
					className: wp.sheetCol,
					children: u
				})]
			})]
		})
	});
}
var Op = {
	lock: "_lock_7wnxk_1",
	form: "_form_7wnxk_8",
	title: "_title_7wnxk_14",
	unlock: "_unlock_7wnxk_22",
	problem: "_problem_7wnxk_26",
	actions: "_actions_7wnxk_32",
	forgot: "_forgot_7wnxk_38",
	paused: "_paused_7wnxk_48"
};
//#endregion
//#region app/ui/src/app/LockScreen.tsx
function kp({ workspaceName: e, unlockControl: t, device: n, onRecoveryKit: r, wrong: i = !1, waitUntil: a }) {
	let o = j(), s = a === void 0 ? i ? o("SH-02.wrong") : void 0 : o("SH-02.wait", { time: a });
	return /* @__PURE__ */ (0, A.jsx)("main", {
		className: Op.lock,
		"aria-labelledby": "lock-title",
		children: /* @__PURE__ */ (0, A.jsxs)("div", {
			className: Op.form,
			children: [
				/* @__PURE__ */ (0, A.jsx)(vr, {}),
				/* @__PURE__ */ (0, A.jsx)("h1", {
					id: "lock-title",
					className: Op.title,
					children: o("SH-02.title", { workspace: e })
				}),
				/* @__PURE__ */ (0, A.jsx)("div", {
					className: Op.unlock,
					children: t
				}),
				s !== void 0 && /* @__PURE__ */ (0, A.jsx)("p", {
					className: Op.problem,
					role: "alert",
					children: s
				}),
				n && /* @__PURE__ */ (0, A.jsx)("div", {
					className: Op.actions,
					children: /* @__PURE__ */ (0, A.jsx)(wr, {
						variant: "link",
						onClick: n.onUnlock,
						disabled: a !== void 0,
						children: o("SH-02.device", { device: n.name })
					})
				}),
				r && /* @__PURE__ */ (0, A.jsxs)("p", {
					className: Op.forgot,
					children: [/* @__PURE__ */ (0, A.jsx)(wr, {
						variant: "link",
						onClick: r,
						children: o("SH-02.forgot")
					}), /* @__PURE__ */ (0, A.jsx)("span", { children: o("SH-02.forgot.note") })]
				}),
				/* @__PURE__ */ (0, A.jsx)("p", {
					className: Op.paused,
					children: o("SH-02.paused")
				})
			]
		})
	});
}
//#endregion
//#region app/ui/src/app/plural.ts
function Ap(e) {
	if (e === null || !/^\d+$/.test(e)) return 2;
	let t = e.replace(/^0+(?=\d)/, "");
	return t === "0" ? 0 : t === "1" ? 1 : 2;
}
var jp = {
	label: "_label_9a4ch_1",
	amber: "_amber_9a4ch_10"
};
//#endregion
//#region app/ui/src/parts/Label.tsx
function Mp({ kind: e, className: t }) {
	let n = j(), r = e === "guess" || e === "stale" || e === "late" ? jp.amber : "";
	return /* @__PURE__ */ (0, A.jsx)("span", {
		className: [
			jp.label,
			r,
			t
		].filter(Boolean).join(" "),
		children: n(`LABEL.${e}`)
	});
}
//#endregion
//#region app/ui/src/app/presentation.ts
function Np(e) {
	return e !== void 0 && e.kind !== "missing" && e.receiptId.length > 0;
}
function Pp(e) {
	return e.kind === "missing" ? e.missing : "unknown";
}
var Fp = {
	figure: "_figure_qy1mi_1",
	row: "_row_qy1mi_9",
	tile: "_tile_qy1mi_10",
	big: "_big_qy1mi_11",
	button: "_button_qy1mi_13",
	missing: "_missing_qy1mi_28",
	asWritten: "_asWritten_qy1mi_34",
	label: "_label_qy1mi_40"
}, Ip = {
	absent: "MISSING.absent",
	null: "MISSING.null",
	unknown: "MISSING.unknown",
	withheld: "MISSING.withheld",
	"not-applicable": "MISSING.not-applicable",
	"not-loaded-yet": "MISSING.not-loaded-yet",
	"not-counted": "MISSING.not-counted",
	"cash-not-captured": "MISSING.cash-not-captured",
	"not-agreed": "MISSING.not-agreed",
	none: "MISSING.none"
};
function Lp({ missing: e, className: t }) {
	let n = j();
	return /* @__PURE__ */ (0, A.jsx)("span", {
		className: [Fp.missing, t].filter(Boolean).join(" "),
		children: n(Ip[e])
	});
}
function Rp({ value: e, size: t = "row", onReceipt: n, tabStop: r = !0, statement: i, className: a }) {
	let o = j(), s = [
		Fp.figure,
		Fp[t],
		a
	].filter(Boolean).join(" ");
	return Np(e) ? /* @__PURE__ */ (0, A.jsxs)("span", {
		className: s,
		children: [
			/* @__PURE__ */ (0, A.jsx)("button", {
				type: "button",
				className: [Fp.button, "fig"].join(" "),
				title: o("FIGURE.title", {
					exact: e.exact,
					receipt: e.receiptId
				}),
				"aria-label": e.spoken === void 0 ? void 0 : o("FIGURE.spoken", { spoken: e.spoken }),
				tabIndex: r ? 0 : -1,
				onClick: () => n(e.receiptId),
				children: e.display
			}),
			e.asWritten !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
				className: Fp.asWritten,
				children: e.asWritten
			}),
			e.labels.map((e) => /* @__PURE__ */ (0, A.jsx)(Mp, {
				kind: e,
				className: Fp.label
			}, e)),
			i !== void 0 && /* @__PURE__ */ (0, A.jsx)(Mp, {
				kind: i,
				className: Fp.label
			})
		]
	}) : /* @__PURE__ */ (0, A.jsx)(Lp, {
		missing: Pp(e),
		className: s
	});
}
var zp = {
	state: "_state_1wqfm_1",
	p: "_p_1wqfm_8",
	note: "_note_1wqfm_12",
	code: "_code_1wqfm_18"
}, Bp = {
	"no-change": "ST.noChange.plain",
	loading: "ST.loading",
	partial: "ST.partial.plain",
	stale: "ST.stale.plain",
	insufficient: "ST.notEnough.plain",
	"not-yet": "ST.notYet",
	"rule-stopped": "ST.rule.plain",
	failed: "ST.failed",
	"network-waiting": "ST.network",
	"read-only": "ST.readOnly.plain",
	hidden: "ST.hidden",
	locked: "ST.locked",
	"not-built": "ST.notBuilt"
};
function Vp({ state: e, action: t, emptyKey: n = "ST.empty.review", className: r }) {
	let i = j(), a = [zp.state, r].filter(Boolean).join(" "), o = t ? /* @__PURE__ */ (0, A.jsx)(wr, {
		variant: "link",
		onClick: t.onPress,
		children: t.label
	}) : null;
	switch (e.kind) {
		case "ready": return null;
		case "loading": return /* @__PURE__ */ (0, A.jsxs)("p", {
			className: a,
			role: "status",
			children: [e.lastKnownAt === void 0 ? i("ST.loading") : i("ST.loading.lastKnown", { time: e.lastKnownAt }), e.reading !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
				className: zp.note,
				children: i("ST.loading.reading", { what: e.reading })
			})]
		});
		case "empty": return /* @__PURE__ */ (0, A.jsxs)("p", {
			className: a,
			children: [
				i(n),
				" ",
				o
			]
		});
		case "partial": return /* @__PURE__ */ (0, A.jsxs)("p", {
			className: a,
			children: [/* @__PURE__ */ (0, A.jsx)(Lp, { missing: e.missing }), e.detail !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
				className: zp.note,
				children: e.detail
			})]
		});
		case "no-change": return /* @__PURE__ */ (0, A.jsx)("p", {
			className: a,
			children: e.since === void 0 ? i("ST.noChange.plain") : i("ST.noChange", { since: e.since })
		});
		case "not-enough": return /* @__PURE__ */ (0, A.jsxs)("p", {
			className: a,
			children: [
				e.monthsNotLoaded && e.monthsNotLoaded.exact !== null ? i("ST.notEnough", {
					count: Ap(e.monthsNotLoaded.exact),
					display: e.monthsNotLoaded.display
				}) : i("ST.notEnough.plain"),
				" ",
				o
			]
		});
		case "stale": return /* @__PURE__ */ (0, A.jsxs)("p", {
			className: a,
			children: [
				/* @__PURE__ */ (0, A.jsx)(Mp, { kind: "stale" }),
				" ",
				/* @__PURE__ */ (0, A.jsx)("span", { children: i("ST.stale.since", { date: e.workedOutOn }) }),
				" ",
				t && /* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "link",
					onClick: t.onPress,
					children: i("ST.rebuild")
				})
			]
		});
		case "not-yet": return /* @__PURE__ */ (0, A.jsxs)("p", {
			className: a,
			children: [
				i("ST.notYet"),
				" ",
				/* @__PURE__ */ (0, A.jsx)("span", {
					className: zp.note,
					children: i("ST.notYet.wanted")
				}),
				" ",
				o
			]
		});
		case "stopped-by-rule": return /* @__PURE__ */ (0, A.jsxs)("p", {
			className: a,
			children: [i("ST.rule", { rule: e.rule }), e.who !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
				className: zp.note,
				children: i("ST.rule.who", { who: e.who })
			})]
		});
		case "failed": return /* @__PURE__ */ (0, A.jsxs)("div", {
			className: a,
			children: [
				e.what === void 0 ? /* @__PURE__ */ (0, A.jsx)("p", {
					className: zp.p,
					children: i("ST.failed")
				}) : /* @__PURE__ */ (0, A.jsx)("p", {
					className: zp.p,
					children: e.what
				}),
				e.means !== void 0 && /* @__PURE__ */ (0, A.jsx)("p", {
					className: zp.p,
					children: e.means
				}),
				(e.action !== void 0 || o) && /* @__PURE__ */ (0, A.jsxs)("p", {
					className: zp.p,
					children: [
						e.action,
						" ",
						o
					]
				}),
				/* @__PURE__ */ (0, A.jsx)("p", {
					className: [zp.code, "fig"].join(" "),
					children: i("ST.failed.code", { code: e.code })
				})
			]
		});
		case "waiting-for-network": return /* @__PURE__ */ (0, A.jsx)("p", {
			className: a,
			role: "status",
			children: i("ST.network")
		});
		case "read-only": return /* @__PURE__ */ (0, A.jsx)("p", {
			className: a,
			children: e.holder === void 0 ? i("ST.readOnly.plain") : i("ST.readOnly", { holder: e.holder })
		});
		case "hidden": return /* @__PURE__ */ (0, A.jsxs)("p", {
			className: a,
			children: [i("ST.hidden"), e.rows !== void 0 && e.rows.exact !== null && /* @__PURE__ */ (0, A.jsx)("span", {
				className: zp.note,
				children: i("ST.hidden.total", {
					count: Ap(e.rows.exact),
					display: e.rows.display
				})
			})]
		});
		case "refused": return /* @__PURE__ */ (0, A.jsx)("p", {
			className: a,
			children: i("ST.refused", { reason: e.reason })
		});
		case "locked": return /* @__PURE__ */ (0, A.jsx)("p", {
			className: a,
			children: i("ST.locked")
		});
		case "not-built": {
			let t = e.capability, n = t !== void 0 && t.state !== "live" ? t : void 0;
			return /* @__PURE__ */ (0, A.jsxs)("div", {
				className: a,
				children: [
					/* @__PURE__ */ (0, A.jsx)("p", {
						className: zp.p,
						children: n?.expectedDay === void 0 ? i("ST.notBuilt") : i("ST.notBuilt.day", { day: n.expectedDay })
					}),
					n !== void 0 && /* @__PURE__ */ (0, A.jsx)("p", {
						className: [zp.code, "fig"].join(" "),
						children: i("ST.boundary.reason", { code: n.reasonCode })
					}),
					n?.state === "partial" && /* @__PURE__ */ (0, A.jsxs)("p", {
						className: zp.note,
						children: [
							/* @__PURE__ */ (0, A.jsx)(Mp, { kind: "experimental" }),
							" ",
							i("ST.partial.label")
						]
					})
				]
			});
		}
		case "boundary-state": {
			let t = e.source, r = t.kind;
			return r === "ready" ? null : r === "empty" ? /* @__PURE__ */ (0, A.jsxs)("p", {
				className: a,
				children: [
					i(n),
					" ",
					o
				]
			}) : /* @__PURE__ */ (0, A.jsxs)("div", {
				className: a,
				role: r === "loading" || r === "network-waiting" ? "status" : void 0,
				children: [
					/* @__PURE__ */ (0, A.jsxs)("p", {
						className: zp.p,
						children: [
							i(Bp[r]),
							" ",
							o
						]
					}),
					"asOf" in t && t.asOf !== null && /* @__PURE__ */ (0, A.jsx)("p", {
						className: [zp.code, "fig"].join(" "),
						children: i("ST.boundary.asOf", { asOf: t.asOf })
					}),
					"reasonCode" in t && /* @__PURE__ */ (0, A.jsx)("p", {
						className: [zp.code, "fig"].join(" "),
						children: i("ST.boundary.reason", { code: t.reasonCode })
					})
				]
			});
		}
	}
}
var Hp = {
	header: "_header_1a5lt_1",
	whereLine: "_whereLine_1a5lt_7",
	titleLine: "_titleLine_1a5lt_8",
	where: "_where_1a5lt_7",
	title: "_title_1a5lt_8",
	count: "_count_1a5lt_32",
	aside: "_aside_1a5lt_38"
};
//#endregion
//#region app/ui/src/app/PageHeader.tsx
function Up({ where: e, title: t, titleId: n, count: r, aside: i, top: a }) {
	return /* @__PURE__ */ (0, A.jsxs)("header", {
		className: Hp.header,
		children: [/* @__PURE__ */ (0, A.jsxs)("div", {
			className: Hp.whereLine,
			children: [/* @__PURE__ */ (0, A.jsx)("p", {
				className: Hp.where,
				children: e
			}), a]
		}), /* @__PURE__ */ (0, A.jsxs)("div", {
			className: Hp.titleLine,
			children: [/* @__PURE__ */ (0, A.jsxs)("h1", {
				id: n,
				className: Hp.title,
				children: [t, r && /* @__PURE__ */ (0, A.jsx)("span", {
					className: [Hp.count, "fig"].join(" "),
					children: r.display
				})]
			}), i && /* @__PURE__ */ (0, A.jsx)("div", {
				className: Hp.aside,
				children: i
			})]
		})]
	});
}
var Wp = {
	row: "_row_19isk_2",
	line: "_line_19isk_8",
	main: "_main_19isk_16",
	static: "_static_19isk_34",
	what: "_what_19isk_38",
	title: "_title_19isk_47",
	note: "_note_19isk_53",
	asWritten: "_asWritten_19isk_54",
	figure: "_figure_19isk_62",
	arrowSlot: "_arrowSlot_19isk_66",
	arrow: "_arrow_19isk_66",
	arrowOpen: "_arrowOpen_19isk_78",
	selected: "_selected_19isk_82",
	open: "_open_19isk_83",
	expansion: "_expansion_19isk_87"
};
//#endregion
//#region app/ui/src/parts/Row.tsx
function Gp({ open: e }) {
	return /* @__PURE__ */ (0, A.jsx)("svg", {
		className: [Wp.arrow, e ? Wp.arrowOpen : ""].join(" "),
		viewBox: "0 0 8 8",
		"aria-hidden": "true",
		focusable: "false",
		children: /* @__PURE__ */ (0, A.jsx)("path", {
			d: "M2.5 1.5 5 4 2.5 6.5",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "1.2",
			strokeLinecap: "round",
			strokeLinejoin: "round"
		})
	});
}
function Kp({ row: e, selected: t = !1, open: n = !1, tabStop: r, onOpen: i, onReceipt: a, onKeyDown: o, expansion: s, registerOrigin: c }) {
	let l = j(), u = /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)(Sr, {
		mark: e.mark,
		wordsKey: e.markWordsKey
	}), /* @__PURE__ */ (0, A.jsxs)("span", {
		className: Wp.what,
		children: [
			/* @__PURE__ */ (0, A.jsx)("span", {
				className: Wp.title,
				children: e.what
			}),
			e.note !== void 0 && e.note.length > 0 && /* @__PURE__ */ (0, A.jsx)("span", {
				className: Wp.note,
				children: e.note
			}),
			e.asWritten !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
				className: [Wp.asWritten, "fig"].join(" "),
				children: e.asWritten
			}),
			e.owner !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
				className: Wp.note,
				children: l("EN.owner", { name: e.owner })
			})
		]
	})] });
	return /* @__PURE__ */ (0, A.jsxs)("li", {
		className: [
			Wp.row,
			t ? Wp.selected : "",
			n ? Wp.open : ""
		].filter(Boolean).join(" "),
		"data-row-id": e.id,
		children: [/* @__PURE__ */ (0, A.jsxs)("div", {
			className: Wp.line,
			children: [
				i ? /* @__PURE__ */ (0, A.jsx)("button", {
					type: "button",
					className: Wp.main,
					"data-row-main": "",
					tabIndex: r ? 0 : -1,
					"aria-expanded": s === void 0 ? void 0 : n,
					"aria-current": t ? "true" : void 0,
					onClick: (t) => i(e.id, t.currentTarget),
					onKeyDown: o,
					ref: (t) => c?.(e.id, t),
					children: u
				}) : /* @__PURE__ */ (0, A.jsx)("div", {
					className: [Wp.main, Wp.static].join(" "),
					children: u
				}),
				e.figure !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
					className: Wp.figure,
					"data-row-figure": "",
					children: /* @__PURE__ */ (0, A.jsx)(Rp, {
						value: e.figure,
						onReceipt: a,
						tabStop: i === void 0,
						statement: e.statement
					})
				}),
				/* @__PURE__ */ (0, A.jsx)("span", {
					className: Wp.arrowSlot,
					"aria-hidden": "true",
					children: i && /* @__PURE__ */ (0, A.jsx)(Gp, { open: n })
				})
			]
		}), n && s !== void 0 && /* @__PURE__ */ (0, A.jsx)("div", {
			className: Wp.expansion,
			children: s
		})]
	});
}
var qp = {
	list: "_list_utcc2_1",
	seeAll: "_seeAll_utcc2_8"
}, Jp = "[data-row-main]", Yp = "[data-row-figure] button";
function Xp({ rows: e, selectedId: t, openId: n, onOpen: r, opens: i, onReceipt: a, expansion: o, seeAll: s, labelledBy: c, registerOrigin: l, className: u }) {
	let d = j(), f = (0, _.useRef)(null), [p, m] = (0, _.useState)(void 0), h = (e) => r !== void 0 && (i === void 0 || i(e)), g = e.filter(h), v = g.some((e) => e.id === p) ? p : g[0]?.id, y = (e, t) => {
		let n = f.current;
		if (!n) return;
		let r = Array.from(n.querySelectorAll(Jp)), i = r[t(r.indexOf(e), r.length - 1)];
		i && (m(i.closest("li")?.dataset.rowId), i.focus());
	}, b = (e) => {
		if (e.target !== e.currentTarget) return;
		let t = e.currentTarget;
		if (e.key === "ArrowDown") e.preventDefault(), y(t, (e, t) => Math.min(e + 1, t));
		else if (e.key === "ArrowUp") e.preventDefault(), y(t, (e) => Math.max(e - 1, 0));
		else if (e.key === "Home") e.preventDefault(), y(t, () => 0);
		else if (e.key === "End") e.preventDefault(), y(t, (e, t) => t);
		else if (e.key === "ArrowRight") {
			let n = t.closest("li")?.querySelector(Yp);
			n && (e.preventDefault(), n.focus());
		}
	};
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: u,
		children: [/* @__PURE__ */ (0, A.jsx)("ul", {
			ref: f,
			className: qp.list,
			"aria-labelledby": c,
			onKeyDown: (e) => {
				if (e.key !== "ArrowLeft" || !(e.target instanceof HTMLElement) || !e.target.matches(Yp)) return;
				let t = e.target.closest("li")?.querySelector(Jp);
				t && (e.preventDefault(), t.focus());
			},
			children: e.map((e) => /* @__PURE__ */ (0, A.jsx)(Kp, {
				row: e,
				selected: e.id === t,
				open: e.id === n,
				tabStop: e.id === v,
				onOpen: h(e) ? r : void 0,
				onReceipt: a,
				onKeyDown: b,
				expansion: o?.(e),
				registerOrigin: l
			}, e.id))
		}), s && /* @__PURE__ */ (0, A.jsx)("div", {
			className: qp.seeAll,
			children: /* @__PURE__ */ (0, A.jsx)(wr, {
				variant: "link",
				onClick: s.onPress,
				children: d("BTN.seeAll", { count: s.count })
			})
		})]
	});
}
//#endregion
//#region app/ui/src/parts/charts/scale.ts
function Zp(e) {
	return /^-?\d+$/.test(e) ? BigInt(e) : null;
}
function Qp(e) {
	let t = null, n = null;
	for (let r of e) r !== null && ((t === null || r < t) && (t = r), (n === null || r > n) && (n = r));
	return t === null || n === null ? null : {
		min: t,
		max: n
	};
}
function $p(e) {
	return {
		min: e.min < 0n ? e.min : 0n,
		max: e.max > 0n ? e.max : 0n
	};
}
var em = 1073741824, tm = 1073741824n;
function nm(e, t) {
	let n = (e < 0n ? 0n : e > t ? t : e) * tm / t;
	return Number(n) / em;
}
function rm(e, t, n, r) {
	for (let e of [n, r]) if (!Number.isFinite(e)) throw RangeError("SCALE_NONFINITE_END");
	let i = t < e, a = i ? e - t : t - e;
	return (t) => {
		if (a === 0n) return n;
		let o = nm(i ? e - t : t - e, a);
		return n * (1 - o) + r * o;
	};
}
function im(e) {
	let t = 0n;
	for (let n of e) if (n !== null) {
		if (n < 0n) return null;
		t += n;
	}
	if (t === 0n) return null;
	let n = t;
	return e.map((e) => e === null ? null : nm(e, n));
}
function am(e, t, n, r) {
	for (let i of [
		e,
		t,
		n,
		r
	]) if (!Number.isFinite(i)) throw RangeError("SCALE_NONFINITE_END");
	let i = t - e, a = Math.min(n, r), o = Math.max(n, r);
	return (s) => {
		if (!Number.isFinite(s)) throw RangeError("SCALE_NONFINITE_VALUE");
		if (e === t || (e < t ? s <= e : s >= e)) return n;
		if (e < t ? s >= t : s <= t) return r;
		let c = Number.isFinite(i) ? (s - e) / i : (s / 2 - e / 2) / (t / 2 - e / 2), l = Math.max(0, Math.min(1, c)), u = n * (1 - l) + r * l;
		return Math.max(a, Math.min(o, u));
	};
}
var om = {
	svg: "_svg_zkehr_4",
	baseline: "_baseline_zkehr_12",
	gap: "_gap_zkehr_17",
	mark: "_mark_zkehr_23",
	hit: "_hit_zkehr_28",
	bar: "_bar_zkehr_33",
	outline: "_outline_zkehr_38",
	ink: "_ink_zkehr_44",
	dim: "_dim_zkehr_45",
	r1: "_r1_zkehr_46",
	r2: "_r2_zkehr_47",
	r3: "_r3_zkehr_48",
	r4: "_r4_zkehr_49",
	segment: "_segment_zkehr_51",
	line: "_line_zkehr_55",
	point: "_point_zkehr_64",
	ring: "_ring_zkehr_69",
	dot: "_dot_zkehr_74",
	label: "_label_zkehr_83",
	labelInk: "_labelInk_zkehr_87",
	missing: "_missing_zkehr_91",
	missingItem: "_missingItem_zkehr_96",
	unavailable: "_unavailable_zkehr_101",
	values: "_values_zkehr_108",
	valueItem: "_valueItem_zkehr_114",
	valueLabel: "_valueLabel_zkehr_120"
};
//#endregion
//#region app/ui/src/parts/charts/marks.tsx
function sm({ label: e, display: t, spoken: n, receiptId: r, onReceipt: i, children: a }) {
	let o = j(), s = o("CHART.open", {
		label: e,
		amount: n ?? t
	}), c = () => i(r);
	return /* @__PURE__ */ (0, A.jsxs)("g", {
		className: om.mark,
		role: "button",
		tabIndex: 0,
		"aria-label": s,
		onClick: c,
		onKeyDown: (e) => {
			(e.key === "Enter" || e.key === " ") && (e.preventDefault(), c());
		},
		children: [/* @__PURE__ */ (0, A.jsx)("title", { children: o("CHART.hover", {
			label: e,
			amount: t
		}) }), a]
	});
}
function cm({ cx: e, cy: t }) {
	return /* @__PURE__ */ (0, A.jsx)("rect", {
		className: om.hit,
		x: e - 12,
		y: t - 12,
		width: 24,
		height: 24
	});
}
function lm({ values: e }) {
	let t = j(), n = e.filter((e) => !Np(e.value));
	return n.length === 0 ? null : /* @__PURE__ */ (0, A.jsx)("p", {
		className: om.missing,
		children: n.map((e) => /* @__PURE__ */ (0, A.jsx)("span", {
			className: om.missingItem,
			children: t("CHART.missing", {
				label: e.label,
				words: t(Ip[Pp(e.value)])
			})
		}, e.id))
	});
}
function um({ values: e, onReceipt: t }) {
	return /* @__PURE__ */ (0, A.jsx)("ul", {
		className: om.values,
		children: e.map((e) => /* @__PURE__ */ (0, A.jsxs)("li", {
			className: om.valueItem,
			children: [/* @__PURE__ */ (0, A.jsx)("span", {
				className: om.valueLabel,
				children: e.label
			}), /* @__PURE__ */ (0, A.jsx)(Rp, {
				value: e.value,
				onReceipt: t
			})]
		}, e.id))
	});
}
//#endregion
//#region app/ui/src/parts/charts/Columns.tsx
var dm = 18;
function fm({ chart: e, onReceipt: t, width: n = 200, height: r = 48, className: i }) {
	let a = Math.max(e.values.length, 1), o = e.values.map((e) => Np(e.value) ? Zp(e.value.exact) : null), s = $p(Qp(o) ?? {
		min: 0n,
		max: 0n
	}), c = rm(s.min, s.max, r, 0), l = c(0n), u = n / a, d = Math.min(24, u * .6), f = r + dm, p = Math.min(Math.max(l, 12), Math.max(r - 12, 12));
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: i,
		children: [/* @__PURE__ */ (0, A.jsxs)("svg", {
			className: om.svg,
			viewBox: `0 0 ${n} ${f}`,
			width: n,
			height: f,
			role: "group",
			"aria-label": e.sentence,
			children: [/* @__PURE__ */ (0, A.jsx)("line", {
				className: om.baseline,
				x1: 0,
				x2: n,
				y1: l,
				y2: l
			}), e.values.map((n, i) => {
				let a = u * i + u / 2, s = o[i] ?? null, m = i === e.values.length - 1, h = n.emphasis ?? m, g = /* @__PURE__ */ (0, A.jsx)("text", {
					className: [om.label, h ? om.labelInk : ""].join(" "),
					x: a,
					y: f - 4,
					textAnchor: "middle",
					children: n.label
				});
				if (!Np(n.value)) return /* @__PURE__ */ (0, A.jsxs)("g", { children: [n.outline ? /* @__PURE__ */ (0, A.jsx)("rect", {
					className: om.outline,
					x: a - d / 2,
					y: 0,
					width: d,
					height: r,
					rx: 4
				}) : /* @__PURE__ */ (0, A.jsx)("line", {
					className: om.gap,
					x1: a - d / 2,
					x2: a + d / 2,
					y1: l,
					y2: l
				}), g] }, n.id);
				let _ = s === null ? null : c(s), v = _ !== null && _ > l;
				return /* @__PURE__ */ (0, A.jsxs)(sm, {
					label: n.label,
					display: n.value.display,
					spoken: n.value.spoken,
					receiptId: n.value.receiptId,
					onReceipt: t,
					children: [
						_ !== null && /* @__PURE__ */ (0, A.jsx)("rect", {
							className: [
								om.bar,
								h ? om.ink : om.dim,
								"m-grow"
							].join(" "),
							style: { transformOrigin: v ? "center top" : "center bottom" },
							x: a - d / 2,
							y: Math.min(_, l),
							width: d,
							height: Math.abs(_ - l),
							rx: 4
						}),
						/* @__PURE__ */ (0, A.jsx)(cm, {
							cx: a,
							cy: p
						}),
						g
					]
				}, n.id);
			})]
		}), /* @__PURE__ */ (0, A.jsx)(lm, { values: e.values })]
	});
}
//#endregion
//#region app/ui/src/parts/charts/Line.tsx
var pm = 18, mm = 6;
function hm({ chart: e, onReceipt: t, width: n = 200, height: r = 48, className: i }) {
	let a = Math.max(e.values.length, 1), o = e.values.map((e) => Np(e.value) ? Zp(e.value.exact) : null), s = Qp(o), c = s ? rm(s.min, s.max, r - mm, mm) : null, l = am(0, Math.max(a - 1, 1), mm, n - mm), u = r + pm, d = o.map((e, t) => e === null || c === null ? null : {
		x: l(t),
		y: c(e)
	}), f = [], p = [], m = null;
	for (let e of d) {
		if (e === null) {
			p.length > 0 && f.push(p), p = [];
			continue;
		}
		p.push(e), m = e;
	}
	return p.length > 0 && f.push(p), /* @__PURE__ */ (0, A.jsxs)("div", {
		className: i,
		children: [/* @__PURE__ */ (0, A.jsxs)("svg", {
			className: om.svg,
			viewBox: `0 0 ${n} ${u}`,
			width: n,
			height: u,
			role: "group",
			"aria-label": e.sentence,
			children: [
				f.map((e, t) => {
					let n = e[0];
					if (n === void 0) return null;
					if (e.length === 1) return n === m ? null : /* @__PURE__ */ (0, A.jsx)("circle", {
						className: om.point,
						cx: n.x,
						cy: n.y
					}, t);
					let r = e.map((e, t) => `${t === 0 ? "M" : "L"}${e.x.toFixed(1)} ${e.y.toFixed(1)}`).join(" ");
					return /* @__PURE__ */ (0, A.jsx)("path", {
						className: [om.line, "m-draw"].join(" "),
						d: r,
						pathLength: 1
					}, t);
				}),
				m !== null && /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)("circle", {
					className: om.ring,
					cx: m.x,
					cy: m.y
				}), /* @__PURE__ */ (0, A.jsx)("circle", {
					className: om.dot,
					cx: m.x,
					cy: m.y
				})] }),
				e.values.map((e, n) => {
					if (!Np(e.value)) return null;
					let i = d[n] ?? {
						x: l(n),
						y: r - mm
					};
					return /* @__PURE__ */ (0, A.jsx)(sm, {
						label: e.label,
						display: e.value.display,
						spoken: e.value.spoken,
						receiptId: e.value.receiptId,
						onReceipt: t,
						children: /* @__PURE__ */ (0, A.jsx)(cm, {
							cx: i.x,
							cy: i.y
						})
					}, e.id);
				}),
				/* @__PURE__ */ (0, A.jsx)("text", {
					className: om.label,
					x: mm,
					y: u - 4,
					textAnchor: "start",
					children: e.from
				}),
				/* @__PURE__ */ (0, A.jsx)("text", {
					className: [om.label, om.labelInk].join(" "),
					x: n - mm,
					y: u - 4,
					textAnchor: "end",
					children: e.to
				})
			]
		}), /* @__PURE__ */ (0, A.jsx)(lm, { values: e.values })]
	});
}
//#endregion
//#region app/ui/src/parts/charts/OrderedBar.tsx
var gm = 10, _m = 2, vm = 12, ym = [
	"r1",
	"r2",
	"r3",
	"r4"
], bm = ["r1", "r3"];
function xm(e, t) {
	let n = t - 1 - e, r = t === 2 ? bm : ym;
	return r[Math.min(n, r.length - 1)] ?? "r1";
}
function Sm({ chart: e, onReceipt: t, width: n = 200, className: r }) {
	let i = j(), a = e.values.length, o = e.values.map((e) => Np(e.value) ? Zp(e.value.exact) : null), s = e.values.some((e, t) => {
		let n = o[t] ?? null;
		return Np(e.value) && (n === null || n < 0n);
	}), c = s ? null : im(o);
	if (c === null) return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: r,
		role: "group",
		"aria-label": e.sentence,
		children: [s && /* @__PURE__ */ (0, A.jsx)("p", {
			className: om.unavailable,
			children: i("CHART.shares.unavailable")
		}), /* @__PURE__ */ (0, A.jsx)(um, {
			values: e.values,
			onReceipt: t
		})]
	});
	let l = e.values.filter((e) => !Np(e.value)).length, u = Math.max(n - _m * Math.max(a - 1, 0) - vm * l, 0), d = gm / 2, f = 0;
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: r,
		children: [/* @__PURE__ */ (0, A.jsx)("svg", {
			className: om.svg,
			viewBox: `0 0 ${n} 28`,
			width: n,
			height: 28,
			role: "group",
			"aria-label": e.sentence,
			children: e.values.map((e, r) => {
				let i = c[r] ?? null, o = i === null ? vm : u * i, s = f;
				f += o + _m;
				let l = xm(r, a), p = r === 0 ? "start" : r === a - 1 ? "end" : "middle", m = r === 0 ? 0 : r === a - 1 ? n : s + o / 2;
				return !Np(e.value) || i === null ? /* @__PURE__ */ (0, A.jsxs)("g", { children: [/* @__PURE__ */ (0, A.jsx)("line", {
					className: om.gap,
					x1: s,
					x2: s + o,
					y1: d,
					y2: d
				}), /* @__PURE__ */ (0, A.jsx)("text", {
					className: om.label,
					x: m,
					y: 24,
					textAnchor: p,
					children: e.label
				})] }, e.id) : /* @__PURE__ */ (0, A.jsxs)(sm, {
					label: e.label,
					display: e.value.display,
					spoken: e.value.spoken,
					receiptId: e.value.receiptId,
					onReceipt: t,
					children: [
						o > 0 && /* @__PURE__ */ (0, A.jsx)("rect", {
							className: [
								om.segment,
								om[l],
								"m-grow-across"
							].join(" "),
							x: s,
							y: 0,
							width: o,
							height: gm
						}),
						/* @__PURE__ */ (0, A.jsx)(cm, {
							cx: s + o / 2,
							cy: d
						}),
						/* @__PURE__ */ (0, A.jsx)("text", {
							className: [om.label, l === "r1" ? om.labelInk : ""].join(" "),
							x: m,
							y: 24,
							textAnchor: p,
							children: e.label
						})
					]
				}, e.id);
			})
		}), /* @__PURE__ */ (0, A.jsx)(lm, { values: e.values })]
	});
}
//#endregion
//#region app/ui/src/parts/charts/Chart.tsx
function Cm({ chart: e, onReceipt: t, width: n, height: r, className: i }) {
	switch (e.form) {
		case "columns": return /* @__PURE__ */ (0, A.jsx)(fm, {
			chart: e,
			onReceipt: t,
			width: n,
			height: r,
			className: i
		});
		case "line": return /* @__PURE__ */ (0, A.jsx)(hm, {
			chart: e,
			onReceipt: t,
			width: n,
			height: r,
			className: i
		});
		case "ordered-bar": return /* @__PURE__ */ (0, A.jsx)(Sm, {
			chart: e,
			onReceipt: t,
			width: n,
			className: i
		});
	}
}
var wm = {
	stat: "_stat_l7cap_1",
	label: "_label_l7cap_7",
	figureLine: "_figureLine_l7cap_12",
	change: "_change_l7cap_19",
	chart: "_chart_l7cap_24",
	unavailable: "_unavailable_l7cap_29"
}, Tm = {
	CHART_NOT_PROVIDED: "CHART.unavailable.CHART_NOT_PROVIDED",
	CHART_FORM_NOT_IMPLEMENTED: "CHART.unavailable.CHART_FORM_NOT_IMPLEMENTED",
	CHART_HAS_NO_POINTS: "CHART.unavailable.CHART_HAS_NO_POINTS",
	CHART_HAS_NO_KNOWN_POINTS: "CHART.unavailable.CHART_HAS_NO_KNOWN_POINTS"
};
function Em({ tile: e, onReceipt: t, chartWidth: n, chartHeight: r, className: i }) {
	let a = j(), o = e.chartState.state === "missing" ? e.chartState.reasonCode : e.chart === void 0 ? "CHART_NOT_PROVIDED" : null;
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: [wm.stat, i].filter(Boolean).join(" "),
		children: [
			/* @__PURE__ */ (0, A.jsx)("span", {
				className: wm.label,
				children: e.label
			}),
			/* @__PURE__ */ (0, A.jsxs)("span", {
				className: wm.figureLine,
				children: [
					/* @__PURE__ */ (0, A.jsx)(Rp, {
						value: e.figure,
						size: "tile",
						onReceipt: t
					}),
					e.changeLabel !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
						className: wm.change,
						children: e.changeLabel
					}),
					e.change !== void 0 && /* @__PURE__ */ (0, A.jsx)(Rp, {
						value: e.change,
						onReceipt: t,
						className: wm.change
					})
				]
			}),
			o === null && e.chart !== void 0 ? /* @__PURE__ */ (0, A.jsx)(Cm, {
				chart: e.chart,
				onReceipt: t,
				width: n,
				height: r,
				className: wm.chart
			}) : /* @__PURE__ */ (0, A.jsx)("p", {
				className: wm.unavailable,
				children: a(Tm[o ?? "CHART_NOT_PROVIDED"])
			})
		]
	});
}
var Dm = {
	line: "_line_bz97d_1",
	mark: "_mark_bz97d_10",
	button: "_button_bz97d_28",
	static: "_static_bz97d_29",
	markRow: "_markRow_bz97d_47",
	time: "_time_bz97d_53",
	words: "_words_bz97d_58",
	note: "_note_bz97d_66",
	figure: "_figure_bz97d_67",
	folded: "_folded_bz97d_74"
};
function Om({ events: e, onReceipt: t, onOpenAll: n, labelledBy: r, className: i }) {
	let a = j(), o = e.slice(0, 6);
	return /* @__PURE__ */ (0, A.jsx)("ol", {
		className: [Dm.line, i].filter(Boolean).join(" "),
		"aria-labelledby": r,
		children: o.map((e, r) => {
			let i = /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [
				/* @__PURE__ */ (0, A.jsx)("span", {
					className: Dm.markRow,
					children: /* @__PURE__ */ (0, A.jsx)(Sr, { mark: e.mark })
				}),
				/* @__PURE__ */ (0, A.jsx)("span", {
					className: [Dm.time, "fig"].join(" "),
					children: e.time
				}),
				/* @__PURE__ */ (0, A.jsx)("span", {
					className: Dm.words,
					children: e.words
				})
			] });
			return /* @__PURE__ */ (0, A.jsxs)("li", {
				className: Dm.mark,
				children: [
					n && r === o.length - 1 ? /* @__PURE__ */ (0, A.jsx)("button", {
						type: "button",
						className: Dm.button,
						onClick: n,
						children: i
					}) : /* @__PURE__ */ (0, A.jsx)("span", {
						className: Dm.static,
						children: i
					}),
					e.note !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
						className: Dm.note,
						children: e.note
					}),
					e.figure !== void 0 && /* @__PURE__ */ (0, A.jsx)(Rp, {
						value: e.figure,
						onReceipt: t,
						className: Dm.figure
					}),
					r === 0 && e.folded !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
						className: Dm.folded,
						children: a("TD-01.folded", { count: e.folded.display })
					})
				]
			}, e.id);
		})
	});
}
var km = {
	choice: "_choice_1xti7_1",
	label: "_label_1xti7_8",
	words: "_words_1xti7_13",
	word: "_word_1xti7_13",
	chosen: "_chosen_1xti7_34",
	pair: "_pair_1xti7_42"
};
//#endregion
//#region app/ui/src/parts/Choice.tsx
function Am({ label: e, labelHidden: t = !1, options: n, value: r, onChange: i, form: a = "words", disabled: o = !1, className: s }) {
	let c = (0, _.useId)();
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: [
			km.choice,
			km[a],
			s
		].filter(Boolean).join(" "),
		children: [/* @__PURE__ */ (0, A.jsx)("span", {
			id: c,
			className: t ? "sr" : km.label,
			children: e
		}), /* @__PURE__ */ (0, A.jsx)("div", {
			role: "radiogroup",
			"aria-labelledby": c,
			className: km.words,
			onKeyDown: (e) => {
				if (o || n.length === 0) return;
				let t = n.findIndex((e) => e.value === r), a = -1;
				if ((e.key === "ArrowRight" || e.key === "ArrowDown") && (a = (t + 1) % n.length), (e.key === "ArrowLeft" || e.key === "ArrowUp") && (a = (t - 1 + n.length) % n.length), a >= 0) {
					e.preventDefault();
					let t = n[a];
					t && i(t.value);
				}
			},
			children: n.map((e) => {
				let t = e.value === r;
				return /* @__PURE__ */ (0, A.jsx)("button", {
					type: "button",
					role: "radio",
					"aria-checked": t,
					tabIndex: t || r === null && e === n[0] ? 0 : -1,
					disabled: o,
					className: [km.word, t ? km.chosen : ""].join(" "),
					onClick: () => i(e.value),
					children: e.label
				}, e.value);
			})
		})]
	});
}
//#endregion
//#region app/ui/src/patterns/Lens.tsx
var jm = [
	"whole-group",
	"finance",
	"sales",
	"operations"
];
function Mm({ value: e, onChange: t, className: n }) {
	let r = j();
	return /* @__PURE__ */ (0, A.jsx)(Am, {
		label: r("EN.lens"),
		labelHidden: !0,
		options: jm.map((e) => ({
			value: e,
			label: r(`EN.lens.${e}`)
		})),
		value: e,
		onChange: t,
		className: n
	});
}
var Nm = {
	field: "_field_6mo0j_1",
	label: "_label_6mo0j_8",
	line: "_line_6mo0j_13",
	prefix: "_prefix_6mo0j_20",
	input: "_input_6mo0j_24",
	problem: "_problem_6mo0j_42"
};
//#endregion
//#region app/ui/src/parts/Field.tsx
function Pm({ label: e, problem: t, prefix: n, className: r, ...i }) {
	let a = (0, _.useId)(), o = `${a}-problem`;
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: [Nm.field, r].filter(Boolean).join(" "),
		children: [
			/* @__PURE__ */ (0, A.jsx)("label", {
				htmlFor: a,
				className: Nm.label,
				children: e
			}),
			/* @__PURE__ */ (0, A.jsxs)("div", {
				className: Nm.line,
				children: [n !== void 0 && /* @__PURE__ */ (0, A.jsx)("span", {
					className: [Nm.prefix, "fig"].join(" "),
					"aria-hidden": "true",
					children: n
				}), /* @__PURE__ */ (0, A.jsx)("input", {
					id: a,
					className: Nm.input,
					"aria-invalid": t ? !0 : void 0,
					"aria-describedby": t ? o : void 0,
					...i
				})]
			}),
			t && /* @__PURE__ */ (0, A.jsx)("p", {
				id: o,
				className: Nm.problem,
				children: t
			})
		]
	});
}
//#endregion
//#region app/ui/src/screens/today/permissions.ts
function Fm(e) {
	return e.kind !== "read-only" && (e.kind !== "boundary-state" || e.source.kind !== "read-only");
}
function Im(e, t) {
	return Fm(e) ? t : {
		...t,
		onPrepare: void 0,
		onResumeSetup: void 0,
		onUpdate: void 0,
		onSaveClosing: void 0
	};
}
//#endregion
//#region app/ui/src/screens/today/shared.tsx
var Lm = "system:setup", Rm = "system:update";
function zm(e, t) {
	let n = j(), r = [];
	if (e.setup) {
		let i = e.setup.can?.includes("continue") === !0 && t.onResumeSetup !== void 0;
		r.push({
			id: Lm,
			mark: "wait",
			what: n("TD-01.setup", {
				step: e.setup.step,
				of: e.setup.of
			}),
			can: i ? ["open"] : []
		});
	}
	if (e.update) {
		let i = e.update.can?.includes("update") === !0 && t.onUpdate !== void 0;
		r.push({
			id: Rm,
			mark: "wait",
			what: n("TD-01.update"),
			can: i ? ["open"] : []
		});
	}
	return r;
}
function Bm(e, t) {
	let n = [...t, ...e.review.rows].slice(0, 4);
	return {
		review: n,
		worth: (e.worthALook ?? []).slice(0, Math.max(0, 5 - n.length))
	};
}
function Vm(e) {
	return e.detail !== void 0 && e.detail.length > 0 || e.can !== void 0 && e.can.length > 0;
}
function Hm({ row: e, intents: t, origin: n }) {
	let r = j(), i = e.can ?? [], a = t.onResumeSetup, o = t.onUpdate, s = t.onPrepare, c = t.onOpenRow;
	return e.id === Lm ? /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)("span", {}), i.includes("open") && a && /* @__PURE__ */ (0, A.jsx)(wr, {
		variant: "filled",
		onClick: () => a(),
		children: r("BTN.continue")
	})] }) : e.id === Rm ? /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)("span", {}), i.includes("open") && o && /* @__PURE__ */ (0, A.jsx)(wr, {
		variant: "filled",
		onClick: () => o(),
		children: r("BTN.update")
	})] }) : /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)("span", { children: e.detail }), i.includes("review") ? /* @__PURE__ */ (0, A.jsx)(wr, {
		variant: "filled",
		onClick: () => t.onReview(e.id, n),
		children: r("BTN.review")
	}) : i.includes("prepare") && s ? /* @__PURE__ */ (0, A.jsx)(wr, {
		variant: "quiet",
		onClick: () => s(e.id),
		children: r("BTN.prepare")
	}) : i.includes("open") && c ? /* @__PURE__ */ (0, A.jsx)(wr, {
		variant: "quiet",
		onClick: () => c(e.id, n),
		children: r("BTN.open")
	}) : null] });
}
function Um() {
	let [e, t] = (0, _.useState)(void 0), n = (0, _.useRef)(/* @__PURE__ */ new Map());
	return {
		openId: e,
		toggle: (e) => t((t) => t === e ? void 0 : e),
		registerOrigin: (e, t) => {
			t ? n.current.set(e, t) : n.current.delete(e);
		},
		originOf: (e) => n.current.get(e) ?? null
	};
}
var z = {
	today: "_today_fgw6n_3",
	section: "_section_fgw6n_11",
	label: "_label_fgw6n_16",
	tiles: "_tiles_fgw6n_23",
	tilesFour: "_tilesFour_fgw6n_28",
	missing: "_missing_fgw6n_41",
	quiet: "_quiet_fgw6n_46",
	cash: "_cash_fgw6n_57",
	cashForm: "_cashForm_fgw6n_65",
	cashLabel: "_cashLabel_fgw6n_71",
	cashField: "_cashField_fgw6n_77",
	cashEntered: "_cashEntered_fgw6n_81",
	cashChart: "_cashChart_fgw6n_85",
	table: "_table_fgw6n_90",
	queueMain: "_queueMain_fgw6n_117",
	selected: "_selected_fgw6n_138",
	thMark: "_thMark_fgw6n_142",
	tdMark: "_tdMark_fgw6n_143",
	num: "_num_fgw6n_147",
	end: "_end_fgw6n_151",
	asWritten: "_asWritten_fgw6n_156",
	since: "_since_fgw6n_157",
	then: "_then_fgw6n_158",
	close: "_close_fgw6n_163",
	closeRow: "_closeRow_fgw6n_170",
	closeName: "_closeName_fgw6n_179",
	closeStatus: "_closeStatus_fgw6n_185",
	closeEnd: "_closeEnd_fgw6n_190"
};
//#endregion
//#region app/ui/src/screens/today/TodaySimple.tsx
function Wm({ data: e, intents: t }) {
	let n = Im(e.state, t), r = j(), i = (0, _.useId)(), a = (0, _.useId)(), [o, s] = (0, _.useState)(""), { review: c, worth: l } = Bm(e, zm(e, n)), u = Um(), d = n.onSaveClosing, f = (e) => /* @__PURE__ */ (0, A.jsx)(Hm, {
		row: e,
		intents: n,
		origin: u.originOf(e.id)
	}), p = (e) => {
		e.preventDefault();
		let t = o.trim();
		t.length !== 0 && d && (d(t), s(""));
	}, m = [...c, ...l];
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: z.today,
		children: [
			/* @__PURE__ */ (0, A.jsx)(Up, {
				where: e.date,
				title: r("TD-01.title"),
				titleId: i,
				count: e.review.count
			}),
			/* @__PURE__ */ (0, A.jsx)(Vp, { state: e.state }),
			m.length === 0 && e.state.kind === "ready" ? /* @__PURE__ */ (0, A.jsx)(Vp, {
				state: { kind: "empty" },
				emptyKey: "ST.empty.review"
			}) : /* @__PURE__ */ (0, A.jsx)(Xp, {
				rows: m,
				labelledBy: i,
				openId: u.openId,
				onOpen: (e) => u.toggle(e),
				opens: Vm,
				onReceipt: n.onReceipt,
				expansion: f,
				registerOrigin: u.registerOrigin,
				seeAll: e.review.total && n.onSeeAll ? {
					count: e.review.total.display,
					onPress: n.onSeeAll
				} : void 0
			}),
			e.cash && /* @__PURE__ */ (0, A.jsxs)("section", {
				className: z.cash,
				"aria-labelledby": a,
				children: [/* @__PURE__ */ (0, A.jsxs)("form", {
					className: z.cashForm,
					onSubmit: p,
					children: [/* @__PURE__ */ (0, A.jsx)("h2", {
						id: a,
						className: z.cashLabel,
						children: r("TD-02.cash")
					}), e.cash.entered ? /* @__PURE__ */ (0, A.jsx)("span", {
						className: z.cashEntered,
						children: /* @__PURE__ */ (0, A.jsx)(Rp, {
							value: e.cash.entered,
							size: "tile",
							onReceipt: n.onReceipt,
							statement: "told-by-owner"
						})
					}) : d ? /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)(Pm, {
						label: r("TD-02.cash"),
						prefix: r("TD-02.cash.rupee"),
						inputMode: "numeric",
						value: o,
						onChange: (e) => s(e.target.value),
						className: z.cashField
					}), /* @__PURE__ */ (0, A.jsx)(wr, {
						variant: "quiet",
						submit: !0,
						children: r("BTN.enter")
					})] }) : /* @__PURE__ */ (0, A.jsx)(Lp, { missing: "cash-not-captured" })]
				}), /* @__PURE__ */ (0, A.jsx)(fm, {
					chart: e.cash.week,
					onReceipt: n.onReceipt,
					className: z.cashChart
				})]
			})
		]
	});
}
//#endregion
//#region app/ui/src/screens/today/TodayBooks.tsx
var Gm = "[data-queue-main]", Km = "[data-queue-receipt] button";
function qm({ data: e, intents: t, sheetId: n }) {
	let r = Im(e.state, t), i = Fm(e.state), a = j(), o = (0, _.useId)(), s = (0, _.useId)(), c = (0, _.useRef)(null), [l, u] = (0, _.useState)(void 0), d = e.queue ?? [], f = r.onOpenQueueRow, p = d.some((e) => e.id === l) ? l : d[0]?.id, m = (e, t) => {
		let n = Array.from(c.current?.querySelectorAll(Gm) ?? []), r = n[n.indexOf(e) + t];
		r && (u(r.dataset.queueMain), r.focus());
	}, h = (e) => {
		if (e.target === e.currentTarget) {
			if (e.key === "ArrowDown") e.preventDefault(), m(e.currentTarget, 1);
			else if (e.key === "ArrowUp") e.preventDefault(), m(e.currentTarget, -1);
			else if (e.key === "ArrowRight") {
				let t = e.currentTarget.closest("tr")?.querySelector(Km);
				t && (e.preventDefault(), t.focus());
			}
		}
	};
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: z.today,
		children: [
			/* @__PURE__ */ (0, A.jsx)(Up, {
				where: e.date,
				title: a("TD-01.title"),
				titleId: o,
				count: e.review.count
			}),
			/* @__PURE__ */ (0, A.jsx)(Vp, { state: e.state }),
			d.length === 0 && e.state.kind === "ready" ? /* @__PURE__ */ (0, A.jsx)(Vp, {
				state: { kind: "empty" },
				emptyKey: "ST.empty.review"
			}) : /* @__PURE__ */ (0, A.jsxs)("table", {
				className: z.table,
				"aria-labelledby": o,
				children: [/* @__PURE__ */ (0, A.jsx)("thead", { children: /* @__PURE__ */ (0, A.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, A.jsx)("th", {
						scope: "col",
						className: z.thMark,
						children: /* @__PURE__ */ (0, A.jsx)("span", {
							className: "sr",
							children: a("TD-03.col.state")
						})
					}),
					/* @__PURE__ */ (0, A.jsx)("th", {
						scope: "col",
						children: a("TD-03.col.what")
					}),
					/* @__PURE__ */ (0, A.jsx)("th", {
						scope: "col",
						children: a("TD-03.col.party")
					}),
					/* @__PURE__ */ (0, A.jsx)("th", {
						scope: "col",
						children: a("TD-03.col.asWritten")
					}),
					/* @__PURE__ */ (0, A.jsx)("th", {
						scope: "col",
						className: z.num,
						children: a("TD-03.col.amount")
					}),
					/* @__PURE__ */ (0, A.jsx)("th", {
						scope: "col",
						children: a("TD-03.col.since")
					}),
					/* @__PURE__ */ (0, A.jsx)("th", {
						scope: "col",
						className: z.end,
						children: a("TD-03.col.then")
					})
				] }) }), /* @__PURE__ */ (0, A.jsx)("tbody", {
					ref: c,
					onKeyDown: (e) => {
						if (e.key !== "ArrowLeft" || !(e.target instanceof HTMLElement) || !e.target.matches(Km)) return;
						let t = e.target.closest("tr")?.querySelector(Gm);
						t && (e.preventDefault(), t.focus());
					},
					children: d.map((e) => /* @__PURE__ */ (0, A.jsxs)("tr", {
						"aria-current": e.id === n ? "true" : void 0,
						className: e.id === n ? z.selected : "",
						children: [
							/* @__PURE__ */ (0, A.jsx)("td", {
								className: z.tdMark,
								children: /* @__PURE__ */ (0, A.jsx)(Sr, {
									mark: e.mark,
									wordsKey: e.markWordsKey
								})
							}),
							/* @__PURE__ */ (0, A.jsx)("th", {
								scope: "row",
								children: f ? /* @__PURE__ */ (0, A.jsx)("button", {
									type: "button",
									className: z.queueMain,
									"data-queue-main": e.id,
									tabIndex: e.id === p ? 0 : -1,
									onKeyDown: h,
									onClick: (t) => f(e.id, t.currentTarget),
									children: e.what
								}) : e.what
							}),
							/* @__PURE__ */ (0, A.jsx)("td", { children: e.party === void 0 ? e.partyMissing === void 0 ? null : /* @__PURE__ */ (0, A.jsx)(Lp, { missing: e.partyMissing }) : e.party }),
							/* @__PURE__ */ (0, A.jsx)("td", {
								className: [z.asWritten, "fig"].join(" "),
								children: e.asWritten
							}),
							/* @__PURE__ */ (0, A.jsx)("td", {
								className: z.num,
								"data-queue-receipt": "",
								children: e.amount !== void 0 && /* @__PURE__ */ (0, A.jsx)(Rp, {
									value: e.amount,
									onReceipt: r.onReceipt,
									tabStop: f === void 0
								})
							}),
							/* @__PURE__ */ (0, A.jsx)("td", {
								className: z.since,
								children: e.since
							}),
							/* @__PURE__ */ (0, A.jsx)("td", {
								className: [z.end, z.then].join(" "),
								children: a(`TD-03.then.${e.then}`)
							})
						]
					}, e.id))
				})]
			}),
			e.close && /* @__PURE__ */ (0, A.jsxs)("section", {
				className: z.section,
				"aria-labelledby": s,
				children: [/* @__PURE__ */ (0, A.jsx)("h2", {
					id: s,
					className: z.label,
					children: a("TD-03.close", { month: e.close.month })
				}), /* @__PURE__ */ (0, A.jsx)("ul", {
					className: z.close,
					children: e.close.steps.map((e) => /* @__PURE__ */ (0, A.jsxs)("li", {
						className: z.closeRow,
						children: [
							/* @__PURE__ */ (0, A.jsx)(Sr, { mark: e.mark }),
							/* @__PURE__ */ (0, A.jsx)("span", {
								className: z.closeName,
								children: e.name
							}),
							/* @__PURE__ */ (0, A.jsx)("span", {
								className: [z.closeStatus, e.statusMono ? "fig" : ""].join(" "),
								children: e.status
							}),
							/* @__PURE__ */ (0, A.jsx)("span", {
								className: z.closeEnd,
								children: e.chart ? /* @__PURE__ */ (0, A.jsx)(Cm, {
									chart: e.chart,
									onReceipt: r.onReceipt
								}) : i && e.action ? /* @__PURE__ */ (0, A.jsx)(wr, {
									variant: "link",
									onClick: e.action.onPress,
									children: e.action.label
								}) : null
							})
						]
					}, e.id))
				})]
			})
		]
	});
}
//#endregion
//#region app/ui/src/screens/today/Today.tsx
function Jm(e) {
	return e.view === "simple" ? /* @__PURE__ */ (0, A.jsx)(Wm, { ...e }) : e.view === "books" ? /* @__PURE__ */ (0, A.jsx)(qm, { ...e }) : /* @__PURE__ */ (0, A.jsx)(Ym, { ...e });
}
function Ym({ data: e, intents: t }) {
	let n = Im(e.state, t), r = j(), i = (0, _.useId)(), a = (0, _.useId)(), o = (0, _.useId)(), s = (0, _.useId)(), c = (0, _.useId)(), { review: l, worth: u } = Bm(e, zm(e, n)), d = Um(), f = e.enterprise, p = n.onOpenRow, m = n.onLens, h = (e) => /* @__PURE__ */ (0, A.jsx)(Hm, {
		row: e,
		intents: n,
		origin: d.originOf(e.id)
	}), g = (e) => e.can?.includes("open") === !0, v = e.review.total && n.onSeeAll ? {
		count: e.review.total.display,
		onPress: n.onSeeAll
	} : void 0;
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: z.today,
		children: [
			/* @__PURE__ */ (0, A.jsx)(Up, {
				where: e.date,
				title: r("TD-01.title"),
				titleId: i,
				count: e.review.count,
				top: f && m ? /* @__PURE__ */ (0, A.jsx)(Mm, {
					value: f.lens,
					onChange: m
				}) : void 0,
				aside: f && v ? /* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "link",
					onClick: v.onPress,
					children: r("BTN.seeAll", { count: v.count })
				}) : void 0
			}),
			/* @__PURE__ */ (0, A.jsx)(Vp, { state: e.state }),
			l.length === 0 && e.state.kind === "ready" ? /* @__PURE__ */ (0, A.jsx)(Vp, {
				state: { kind: "empty" },
				emptyKey: "ST.empty.review"
			}) : /* @__PURE__ */ (0, A.jsx)(Xp, {
				rows: l,
				labelledBy: i,
				openId: d.openId,
				onOpen: (e) => d.toggle(e),
				opens: Vm,
				onReceipt: n.onReceipt,
				expansion: h,
				registerOrigin: d.registerOrigin,
				seeAll: f ? void 0 : v
			}),
			u.length > 0 && /* @__PURE__ */ (0, A.jsxs)("section", {
				className: z.section,
				"aria-labelledby": a,
				children: [/* @__PURE__ */ (0, A.jsx)("h2", {
					id: a,
					className: z.label,
					children: r("TD-01.worth")
				}), /* @__PURE__ */ (0, A.jsx)(Xp, {
					rows: u,
					labelledBy: a,
					onOpen: p,
					opens: g,
					onReceipt: n.onReceipt
				})]
			}),
			/* @__PURE__ */ (0, A.jsxs)("section", {
				className: z.section,
				"aria-labelledby": o,
				children: [/* @__PURE__ */ (0, A.jsx)("h2", {
					id: o,
					className: z.label,
					children: r(f ? "EN.month" : "TD-01.month")
				}), e.thisMonth && e.thisMonth.length > 0 ? /* @__PURE__ */ (0, A.jsx)("div", {
					className: [z.tiles, e.thisMonth.length > 3 ? z.tilesFour : ""].join(" "),
					children: e.thisMonth.map((e) => /* @__PURE__ */ (0, A.jsx)(Em, {
						tile: e,
						onReceipt: n.onReceipt
					}, e.id))
				}) : /* @__PURE__ */ (0, A.jsx)("p", {
					className: z.missing,
					children: /* @__PURE__ */ (0, A.jsx)(Lp, { missing: e.thisMonthMissing ?? "not-loaded-yet" })
				})]
			}),
			f?.changedSince && /* @__PURE__ */ (0, A.jsxs)("section", {
				className: z.section,
				"aria-labelledby": s,
				children: [
					/* @__PURE__ */ (0, A.jsx)("h2", {
						id: s,
						className: z.label,
						children: r("EN.changed", { since: f.changedSince.since })
					}),
					/* @__PURE__ */ (0, A.jsx)(Xp, {
						rows: f.changedSince.rows,
						labelledBy: s,
						onOpen: p,
						opens: g,
						onReceipt: n.onReceipt
					}),
					f.quietLines && f.quietLines.length > 0 && /* @__PURE__ */ (0, A.jsx)("p", {
						className: z.quiet,
						children: f.quietLines.map((e, t) => /* @__PURE__ */ (0, A.jsx)("span", { children: e }, t))
					})
				]
			}),
			!f && /* @__PURE__ */ (0, A.jsxs)("section", {
				className: z.section,
				"aria-labelledby": c,
				children: [/* @__PURE__ */ (0, A.jsx)("h2", {
					id: c,
					className: z.label,
					children: r("TD-01.earlier")
				}), e.earlierToday && e.earlierToday.length > 0 ? /* @__PURE__ */ (0, A.jsx)(Om, {
					events: e.earlierToday,
					onReceipt: n.onReceipt,
					onOpenAll: n.onOpenActivity,
					labelledBy: c
				}) : /* @__PURE__ */ (0, A.jsx)("p", {
					className: z.missing,
					children: e.earlierTodayMissing === void 0 ? r("TD-01.earlier.none") : /* @__PURE__ */ (0, A.jsx)(Lp, { missing: e.earlierTodayMissing })
				})]
			})
		]
	});
}
//#endregion
//#region app/ui/src/app/App.tsx
function Xm() {
	return Hn(typeof window < "u" ? window.location.hash : "");
}
function Zm({ locked: e }) {
	let t = j();
	return /* @__PURE__ */ (0, A.jsx)("main", {
		className: Op.lock,
		children: /* @__PURE__ */ (0, A.jsx)("div", {
			className: Op.form,
			children: /* @__PURE__ */ (0, A.jsx)("h1", {
				className: Op.title,
				children: t(e ? "ST.locked" : "ST.noAccess")
			})
		})
	});
}
function Qm(e) {
	let { shellKind: t, view: n, administers: r, allowed: i, onAddress: a } = e, o = (0, _.useMemo)(() => ({
		kind: t,
		view: n,
		administers: r,
		allowed: i
	}), [
		t,
		n,
		r,
		i
	]), [s, c] = (0, _.useState)(Xm), l = ur(o, s), u = e.lock != null || fr(e.today.data.state), d = u || l === null ? null : Un(l), f = (0, _.useMemo)(() => d === null ? null : Hn(d), [d]);
	(0, _.useEffect)(() => {
		let e = () => {
			let e = Xm();
			c((t) => Wn(t, e) ? t : e);
		};
		return window.addEventListener("hashchange", e), () => window.removeEventListener("hashchange", e);
	}, []), (0, _.useEffect)(() => {
		let t = document.documentElement;
		t.lang = e.language, e.view === "guided" ? t.removeAttribute("data-view") : t.setAttribute("data-view", e.view), e.themeOverride ? t.setAttribute("data-theme", e.themeOverride) : t.removeAttribute("data-theme");
	}, [
		e.language,
		e.view,
		e.themeOverride
	]), (0, _.useLayoutEffect)(() => {
		a?.(f);
	}, [f, a]);
	let p = (0, _.useCallback)((e) => {
		let t = ur(o, e);
		t !== null && (Wn(t, s) || (window.location.hash = Un(t), c(t)));
	}, [s, o]);
	if (u) return /* @__PURE__ */ (0, A.jsx)(Fn, {
		language: e.language,
		children: e.lock ? /* @__PURE__ */ (0, A.jsx)(kp, { ...e.lock }) : /* @__PURE__ */ (0, A.jsx)(Zm, { locked: !0 })
	});
	if (l === null) return /* @__PURE__ */ (0, A.jsx)(Fn, {
		language: e.language,
		children: /* @__PURE__ */ (0, A.jsx)(Zm, { locked: !1 })
	});
	let m = dr(l, e.sheet), h, g = !1;
	if (l.place === "today" && e.shellKind !== "ca-firm" && (l.sub === void 0 || l.sub === "today")) h = /* @__PURE__ */ (0, A.jsx)(Jm, {
		...e.today,
		view: e.view,
		sheetId: l.sheet,
		onNavigate: p
	}), g = e.view === "books" || e.shellKind === "enterprise";
	else {
		let t = e.renderPlace?.(l), n = e.capabilities[l.place];
		h = t ?? /* @__PURE__ */ (0, A.jsx)(Vp, { state: n === void 0 ? { kind: "not-built" } : {
			kind: "not-built",
			capability: n
		} });
	}
	return /* @__PURE__ */ (0, A.jsx)(Fn, {
		language: e.language,
		children: /* @__PURE__ */ (0, A.jsx)(Dp, {
			shell: o,
			address: l,
			onNavigate: p,
			counts: e.counts,
			menu: {
				...e.menu,
				view: e.view,
				language: e.language
			},
			banners: e.banners,
			ask: e.ask,
			status: e.status,
			statusSimple: e.statusSimple,
			wide: g,
			sheet: m,
			onHelp: e.onHelp,
			children: h
		})
	});
}
//#endregion
//#region app/ui/src/bridge/validate.ts
var $m = class extends Error {
	code = "INVALID_REPLY";
	path;
	constructor(e) {
		super("INVALID_REPLY"), this.name = "ReplyValidationError", this.path = e;
	}
};
function B(e) {
	throw new $m(e);
}
function eh(e, t) {
	(typeof e != "object" || !e || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype) && B(t), Object.getOwnPropertySymbols(e).length > 0 && B(t);
	for (let n of Object.values(Object.getOwnPropertyDescriptors(e))) (!Object.hasOwn(n, "value") || !n.enumerable) && B(t);
	return e;
}
function th(e, t, n, r = []) {
	let i = eh(e, t);
	return (n.some((e) => !Object.hasOwn(i, e)) || Object.keys(i).some((e) => !n.includes(e) && !r.includes(e))) && B(t), Object.values(i).some((e) => e === void 0) && B(t), i;
}
function nh(e, t, n = 8e3, r = !1) {
	(typeof e != "string" || e.length > n || !r && e.trim().length === 0 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(e)) && B(t);
}
function rh(e, t) {
	nh(e, t, 200);
}
function ih(e, t, n) {
	(typeof e != "string" || !n.includes(e)) && B(t);
}
function ah(e, t) {
	typeof e != "boolean" && B(t);
}
function oh(e, t, n = 2 ** 53 - 1) {
	(typeof e != "number" || !Number.isSafeInteger(e) || e < 0 || e > n) && B(t);
}
function sh(e, t = "integer", n = !0) {
	(typeof e != "string" || e.length > 256 || !(n ? /^-?\d+$/ : /^\d+$/).test(e)) && B(t);
}
function ch(e, t, n, r) {
	(!Array.isArray(e) || Object.getPrototypeOf(e) !== Array.prototype || e.length > n || Object.getOwnPropertySymbols(e).length > 0) && B(t);
	for (let [n, r] of Object.entries(Object.getOwnPropertyDescriptors(e))) (!Object.hasOwn(r, "value") || n !== "length" && !/^(?:0|[1-9]\d*)$/.test(n)) && B(t);
	for (let n = 0; n < e.length; n++) r(e[n], `${t}[${n}]`);
}
function lh(e, t, n) {
	Array.isArray(e) || B(t);
	let r = e.map((e) => n ? eh(e, t)[n] : e);
	new Set(r).size !== r.length && B(t);
}
function uh(e, t = "date") {
	(typeof e != "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e)) && B(t);
	let n = /* @__PURE__ */ new Date(`${e}T00:00:00.000Z`);
	(!Number.isFinite(n.getTime()) || n.toISOString().slice(0, 10) !== e) && B(t);
}
function dh(e, t = "instant") {
	(typeof e != "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(e)) && B(t), uh(e.slice(0, 10), t);
	let n = Number(e.slice(11, 13)), r = Number(e.slice(14, 16)), i = Number(e.slice(17, 19));
	(n > 23 || r > 59 || i > 59 || !Number.isFinite(Date.parse(e))) && B(t);
	let a = e.match(/([+-])(\d{2}):(\d{2})$/);
	a && (Number(a[2]) > 23 || Number(a[3]) > 59) && B(t);
}
function fh(e, t) {
	typeof e == "string" && /^\d{4}-\d{2}-\d{2}$/.test(e) ? uh(e, t) : dh(e, t);
}
function ph(e, t, n) {
	e !== null && n(e, t);
}
var mh = [
	"cha",
	"you",
	"wait",
	"busy",
	"unsure",
	"guess",
	"off"
], hh = [
	"seed",
	"what-if",
	"projection",
	"from-outside",
	"approximate",
	"demo-clock",
	"stale"
], gh = [
	"absent",
	"null",
	"unknown",
	"withheld",
	"not-applicable",
	"not-loaded-yet",
	"not-counted"
], _h = [
	"columns",
	"line",
	"ordered-bar",
	"ranked-bars",
	"bridge",
	"goal-line",
	"step-line",
	"pair-bars",
	"strip",
	"spark",
	"rule-bar"
];
function vh(e, t) {
	let n = eh(e, t);
	if (ih(n.kind, `${t}.kind`, [
		"money",
		"count",
		"percent",
		"missing"
	]), n.kind === "missing") {
		th(e, t, ["kind", "state"]), ih(n.state, `${t}.state`, gh);
		return;
	}
	th(e, t, [
		"kind",
		"receiptId",
		"labels",
		...n.kind === "money" ? ["currency", "paise"] : n.kind === "count" ? ["count"] : ["basisPoints"]
	]), rh(n.receiptId, `${t}.receiptId`), ch(n.labels, `${t}.labels`, hh.length, (e, t) => ih(e, t, hh)), lh(n.labels, `${t}.labels`), n.kind === "money" ? (ih(n.currency, `${t}.currency`, ["INR"]), sh(n.paise, `${t}.paise`)) : n.kind === "count" ? sh(n.count, `${t}.count`, !1) : sh(n.basisPoints, `${t}.basisPoints`);
}
function yh(e, t) {
	let n = th(e, t, ["type", "address"]);
	ih(n.type, `${t}.type`, ["open-sheet"]), nh(n.address, `${t}.address`, 300), /^#\/(?:today|ask|work|books|reports|tools|trust|company|clients|more)(?:\/[a-z][a-z0-9-]{0,63})?(?:\?sheet=[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199})?$/.exec(n.address)?.[0] !== n.address && B(`${t}.address`);
}
function bh(e, t) {
	let n = th(e, t, [
		"id",
		"mark",
		"title",
		"note"
	], ["figure", "action"]);
	rh(n.id, `${t}.id`), ih(n.mark, `${t}.mark`, mh), nh(n.title, `${t}.title`), nh(n.note, `${t}.note`, 8e3, !0), Object.hasOwn(n, "figure") && (vh(n.figure, `${t}.figure`), n.mark === "guess" && n.figure.kind !== "missing" && B(`${t}.figure`)), Object.hasOwn(n, "action") && yh(n.action, `${t}.action`);
}
function xh(e, t) {
	let n = eh(e, t), r = [
		"ready",
		"empty",
		"no-change"
	], i = [
		"loading",
		"partial",
		"stale"
	], a = [
		"insufficient",
		"not-yet",
		"rule-stopped",
		"failed",
		"network-waiting",
		"read-only",
		"hidden",
		"locked",
		"not-built"
	];
	ih(n.kind, `${t}.kind`, [
		...r,
		...i,
		...a
	]), r.includes(String(n.kind)) ? th(e, t, ["kind"]) : i.includes(String(n.kind)) ? (th(e, t, [
		"kind",
		"asOf",
		"reasonCode"
	]), ph(n.asOf, `${t}.asOf`, fh), rh(n.reasonCode, `${t}.reasonCode`)) : (th(e, t, ["kind", "reasonCode"]), rh(n.reasonCode, `${t}.reasonCode`));
}
function Sh(e, t) {
	let n = th(e, t, [
		"kind",
		"description",
		"points"
	]);
	ih(n.kind, `${t}.kind`, _h), nh(n.description, `${t}.description`), ch(n.points, `${t}.points`, 120, (e, t) => {
		let n = th(e, t, [
			"id",
			"label",
			"value"
		]);
		rh(n.id, `${t}.id`), nh(n.label, `${t}.label`), vh(n.value, `${t}.value`);
	}), lh(n.points, `${t}.points`, "id"), new Set(n.points.map((e) => e.value.kind).filter((e) => e !== "missing")).size > 1 && B(`${t}.points`);
}
function Ch(e, t) {
	let n = th(e, t, [
		"title",
		"date",
		"pendingCount",
		"attention",
		"worthLook",
		"stats",
		"dayEvents",
		"state"
	]);
	if (nh(n.title, `${t}.title`), uh(n.date, `${t}.date`), ph(n.pendingCount, `${t}.pendingCount`, (e, t) => sh(e, t, !1)), ch(n.attention, `${t}.attention`, 4, bh), lh(n.attention, `${t}.attention`, "id"), ch(n.worthLook, `${t}.worthLook`, 5, bh), lh(n.worthLook, `${t}.worthLook`, "id"), Array.isArray(n.attention) && Array.isArray(n.worthLook)) {
		n.attention.length + n.worthLook.length > 5 && B(`${t}.worthLook`);
		let e = [...n.attention, ...n.worthLook].map((e) => e.id);
		new Set(e).size !== e.length && B(`${t}.worthLook`);
	}
	ch(n.stats, `${t}.stats`, 12, (e, t) => {
		let n = th(e, t, [
			"id",
			"label",
			"figure",
			"chart"
		], ["change", "changeLabel"]);
		rh(n.id, `${t}.id`), nh(n.label, `${t}.label`), vh(n.figure, `${t}.figure`), ph(n.chart, `${t}.chart`, Sh), Object.hasOwn(n, "change") && vh(n.change, `${t}.change`), Object.hasOwn(n, "changeLabel") && (nh(n.changeLabel, `${t}.changeLabel`), (!Object.hasOwn(n, "change") || /[\p{N}\u20b9%]/u.test(n.changeLabel)) && B(`${t}.changeLabel`));
	}), lh(n.stats, `${t}.stats`, "id"), ch(n.dayEvents, `${t}.dayEvents`, 6, (e, t) => {
		let n = th(e, t, [
			"id",
			"at",
			"mark",
			"label"
		], ["action"]);
		rh(n.id, `${t}.id`), dh(n.at, `${t}.at`), ih(n.mark, `${t}.mark`, mh), nh(n.label, `${t}.label`), Object.hasOwn(n, "action") && yh(n.action, `${t}.action`);
	}), lh(n.dayEvents, `${t}.dayEvents`, "id"), xh(n.state, `${t}.state`), n.state.kind === "locked" && (n.pendingCount !== null || [
		n.attention,
		n.worthLook,
		n.stats,
		n.dayEvents
	].some((e) => e.length > 0)) && B(`${t}.state`);
}
function wh(e, t) {
	let n = th(e, t, ["from", "to"]);
	uh(n.from, `${t}.from`), uh(n.to, `${t}.to`), n.from > n.to && B(t);
}
function Th(e, t, n = 0) {
	if (n > 12 && B(t), e === null || typeof e == "boolean") return;
	if (typeof e == "string") {
		nh(e, t, 1e5, !0);
		return;
	}
	if (typeof e == "number") {
		Number.isFinite(e) || B(t);
		return;
	}
	if (Array.isArray(e)) {
		ch(e, t, 1e4, (e, t) => Th(e, t, n + 1));
		return;
	}
	let r = eh(e, t);
	Object.keys(r).length > 1e3 && B(t);
	for (let [e, i] of Object.entries(r)) [
		"__proto__",
		"prototype",
		"constructor"
	].includes(e) && B(t), Th(i, `${t}.${e}`, n + 1);
}
var Eh = [
	"id",
	"memberId",
	"epoch",
	"sourceIds",
	"operation",
	"createdAt",
	"asOf",
	"period",
	"comparePeriod",
	"branch",
	"currency",
	"ontologyVersion",
	"dictionaryHash",
	"definitionHash",
	"figures",
	"valueMinor",
	"totalMinor",
	"rowIds",
	"rows",
	"exclusions",
	"coverage",
	"assumptions",
	"explanation",
	"stale",
	"allowedNumbers"
];
function Dh(e, t) {
	let n = th(e, t, Eh, ["staleReason", "requestedSourceIds"]);
	for (let e of [
		"id",
		"memberId",
		"operation",
		"dictionaryHash",
		"definitionHash"
	]) rh(n[e], `${t}.${e}`);
	oh(n.epoch, `${t}.epoch`), oh(n.ontologyVersion, `${t}.ontologyVersion`), ch(n.sourceIds, `${t}.sourceIds`, 1e4, rh), lh(n.sourceIds, `${t}.sourceIds`), Object.hasOwn(n, "requestedSourceIds") && (ch(n.requestedSourceIds, `${t}.requestedSourceIds`, 64, (e, t) => {
		(typeof e != "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(e)) && B(t);
	}), lh(n.requestedSourceIds, `${t}.requestedSourceIds`), n.sourceIds.some((e) => !n.requestedSourceIds.includes(e)) && B(`${t}.requestedSourceIds`)), dh(n.createdAt, `${t}.createdAt`), fh(n.asOf, `${t}.asOf`), ph(n.period, `${t}.period`, wh), ph(n.comparePeriod, `${t}.comparePeriod`, wh), ph(n.branch, `${t}.branch`, rh), (typeof n.currency != "string" || !/^[A-Z]{3}$/.test(n.currency)) && B(`${t}.currency`), ch(n.figures, `${t}.figures`, 120, (e, t) => {
		let r = th(e, t, [
			"key",
			"label",
			"minor",
			"display",
			"unit"
		], ["currency"]);
		rh(r.key, `${t}.key`), nh(r.label, `${t}.label`), sh(r.minor, `${t}.minor`), nh(r.display, `${t}.display`), ih(r.unit, `${t}.unit`, ["money", "basis-points"]), r.unit === "money" && r.currency !== n.currency && B(`${t}.currency`), Object.hasOwn(r, "currency") && (typeof r.currency != "string" || !/^[A-Z]{3}$/.test(r.currency)) && B(`${t}.currency`);
	}), lh(n.figures, `${t}.figures`, "key"), sh(n.valueMinor, `${t}.valueMinor`), sh(n.totalMinor, `${t}.totalMinor`), ch(n.rowIds, `${t}.rowIds`, 1e4, rh), lh(n.rowIds, `${t}.rowIds`), ch(n.rows, `${t}.rows`, 1e4, (e, t) => {
		let n = th(e, t, [
			"factId",
			"entityId",
			"sourceId",
			"sourceRow",
			"kind",
			"amountMinor",
			"validFrom"
		], [
			"measureField",
			"dueDate",
			"invoiceId",
			"customerId",
			"orderId",
			"status",
			"branch",
			"normalization"
		]);
		for (let e of [
			"factId",
			"entityId",
			"sourceId",
			"kind"
		]) rh(n[e], `${t}.${e}`);
		oh(n.sourceRow, `${t}.sourceRow`), n.sourceRow === 0 && B(`${t}.sourceRow`), sh(n.amountMinor, `${t}.amountMinor`), uh(n.validFrom, `${t}.validFrom`), Object.hasOwn(n, "dueDate") && uh(n.dueDate, `${t}.dueDate`);
		for (let e of [
			"measureField",
			"invoiceId",
			"customerId",
			"orderId",
			"status",
			"branch"
		]) Object.hasOwn(n, e) && nh(n[e], `${t}.${e}`);
		if (Object.hasOwn(n, "normalization")) {
			let e = th(n.normalization, `${t}.normalization`, [
				"sourceCurrency",
				"targetCurrency",
				"rate"
			]);
			for (let n of ["sourceCurrency", "targetCurrency"]) (typeof e[n] != "string" || !/^[A-Z]{3}$/.test(e[n])) && B(`${t}.normalization.${n}`);
			Th(e.rate, `${t}.normalization.rate`);
		}
	}), lh(n.rows, `${t}.rows`, "factId"), Array.isArray(n.rows) && Array.isArray(n.rowIds) && (n.rowIds.length !== n.rows.length || n.rows.some((e, t) => e.factId !== n.rowIds[t])) && B(`${t}.rowIds`), ch(n.exclusions, `${t}.exclusions`, 1e4, (e, t) => {
		let n = th(e, t, ["rowId", "reason"]);
		rh(n.rowId, `${t}.rowId`), nh(n.reason, `${t}.reason`);
	});
	let r = th(n.coverage, `${t}.coverage`, [
		"selectedRows",
		"countedRows",
		"excludedRows",
		"unresolvedConflicts",
		"importIds",
		"completeness",
		"gaps"
	]);
	for (let e of [
		"selectedRows",
		"countedRows",
		"excludedRows",
		"unresolvedConflicts"
	]) oh(r[e], `${t}.coverage.${e}`);
	Array.isArray(n.rows) && r.countedRows !== n.rows.length && B(`${t}.coverage.countedRows`), ch(r.importIds, `${t}.coverage.importIds`, 1e4, rh), ch(r.gaps, `${t}.coverage.gaps`, 1e3, nh), ih(r.completeness, `${t}.coverage.completeness`, [
		"reconciled-imports",
		"unreconciled-facts",
		"empty",
		"partial"
	]), eh(n.assumptions, `${t}.assumptions`), Th(n.assumptions, `${t}.assumptions`), nh(n.explanation, `${t}.explanation`, 1e5, !0), ah(n.stale, `${t}.stale`), Object.hasOwn(n, "staleReason") && nh(n.staleReason, `${t}.staleReason`), ch(n.allowedNumbers, `${t}.allowedNumbers`, 1e4, (e, t) => {
		(typeof e != "string" || e.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(e)) && B(t);
	});
}
function Oh(e, t) {
	t(e, "reply");
	let n = structuredClone(e);
	function r(e) {
		e && typeof e == "object" && (Object.freeze(e), Object.values(e).forEach(r));
	}
	return r(n), n;
}
var kh = (e) => Oh(e, vh), Ah = (e) => Oh(e, Ch), jh = (e) => Oh(e, Dh);
function Mh(e) {
	let t = th(e, "receipt", [...Eh, "definitions"], [
		"staleReason",
		"requestedSourceIds",
		"compiledCalculation",
		"databaseProof"
	]);
	Array.isArray(t.definitions) || B("receipt.definitions");
	for (let e of [
		"definitions",
		"compiledCalculation",
		"databaseProof"
	]) Object.hasOwn(t, e) && Th(t[e], `receipt.${e}`);
	let n = {};
	for (let e of [
		...Eh,
		"staleReason",
		"requestedSourceIds"
	]) Object.hasOwn(t, e) && (n[e] = t[e]);
	return jh(n);
}
//#endregion
//#region app/ui/src/bridge/calculation-parameters.ts
var Nh = [
	"period",
	"comparePeriod",
	"assumptions"
], Ph = "Owner-requested price assumption in basis points; scenario only, not a measured fact.", Fh = (e) => {
	throw new $m(e);
};
function Ih(e, t) {
	(!e || typeof e != "object" || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype || Object.getOwnPropertySymbols(e).length) && Fh(t);
	for (let n of Object.values(Object.getOwnPropertyDescriptors(e))) (!n.enumerable || !Object.hasOwn(n, "value")) && Fh(t);
	return e;
}
function Lh(e, t, n, r = []) {
	let i = Ih(e, t);
	return (n.some((e) => !Object.hasOwn(i, e)) || Object.keys(i).some((e) => !n.includes(e) && !r.includes(e)) || Object.values(i).some((e) => e === void 0)) && Fh(t), i;
}
function Rh(e, t) {
	let n = Lh(e, t, ["from", "to"]);
	return uh(n.from, t + ".from"), uh(n.to, t + ".to"), n.from > n.to && Fh(t), {
		from: n.from,
		to: n.to
	};
}
function zh(e, t) {
	if (typeof e != "string" || e.length > 2e4 || !/^-?[0-9]+$/.test(e)) return Fh(t);
	let n = BigInt(e);
	return (n < -10000n || n > 100000n) && Fh(t), e;
}
function Bh(e, t) {
	let n = Lh(e, t, [], Nh), r = {};
	return Object.hasOwn(n, "period") && (r.period = Rh(n.period, t + ".period")), Object.hasOwn(n, "comparePeriod") && (r.comparePeriod = Rh(n.comparePeriod, t + ".comparePeriod")), Object.hasOwn(n, "assumptions") && (r.assumptions = { priceChangeBps: zh(Lh(n.assumptions, t + ".assumptions", ["priceChangeBps"]).priceChangeBps, t + ".assumptions.priceChangeBps") }), r;
}
function Vh(e, t, n) {
	let r = Lh(e, n, [], Nh);
	for (let e of Nh) Object.hasOwn(r, e) !== Object.hasOwn(t, e) && Fh(n + "." + e), Object.hasOwn(r, e) && r[e] !== "owner-requested" && r[e] !== "retained-owner-requested" && Fh(n + "." + e);
	return r;
}
function Hh(e, t) {
	return {
		kind: "owner-requested-calculation-parameters",
		period: e.period ?? null,
		comparePeriod: e.comparePeriod ?? null,
		assumptions: e.assumptions ? {
			origin: "owner-requested",
			label: Ph,
			priceChangeBps: e.assumptions.priceChangeBps
		} : null,
		missingInputClarifications: {
			change: !e.period && !e.comparePeriod ? "Which current and comparison periods should I use?" : e.period ? e.comparePeriod ? null : "Which comparison period should I use?" : "Which current period should I use?",
			scenario: e.assumptions ? null : "What price change in basis points should I assume?"
		},
		origins: t
	};
}
function Uh(e, t, n, r) {
	let i = Lh(e, r, [
		"kind",
		"period",
		"comparePeriod",
		"assumptions",
		"missingInputClarifications",
		"origins"
	]);
	if (i.kind !== "owner-requested-calculation-parameters" && Fh(r + ".kind"), i.period !== null && Rh(i.period, r + ".period"), i.comparePeriod !== null && Rh(i.comparePeriod, r + ".comparePeriod"), i.assumptions !== null) {
		let e = Lh(i.assumptions, r + ".assumptions", [
			"origin",
			"label",
			"priceChangeBps"
		]);
		(e.origin !== "owner-requested" || e.label !== "Owner-requested price assumption in basis points; scenario only, not a measured fact.") && Fh(r + ".assumptions"), zh(e.priceChangeBps, r + ".assumptions.priceChangeBps");
	}
	let a = Lh(i.missingInputClarifications, r + ".missingInputClarifications", ["change", "scenario"]);
	for (let e of ["change", "scenario"]) a[e] !== null && typeof a[e] != "string" && Fh(r + ".missingInputClarifications." + e);
	Vh(i.origins, t, r + ".origins");
	let o = Hh(t, n);
	JSON.stringify(i) !== JSON.stringify(o) && Fh(r);
}
//#endregion
//#region app/ui/src/bridge/conversation-contract.ts
var Wh = /* @__PURE__ */ new WeakMap();
function V(e) {
	throw new $m(e);
}
function Gh(e, t) {
	(!e || typeof e != "object" || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype || Object.getOwnPropertySymbols(e).length) && V(t);
	for (let n of Object.values(Object.getOwnPropertyDescriptors(e))) (!Object.hasOwn(n, "value") || !n.enumerable) && V(t);
	return e;
}
function H(e, t, n, r = []) {
	let i = Gh(e, t);
	return (n.some((e) => !Object.hasOwn(i, e)) || Object.keys(i).some((e) => !n.includes(e) && !r.includes(e)) || Object.values(i).some((e) => e === void 0)) && V(t), i;
}
function U(e, t, n = 2e4, r = !1) {
	(typeof e != "string" || e.length > n || !r && !e.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(e)) && V(t);
}
function Kh(e, t) {
	(typeof e != "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(e)) && V(t);
}
function qh(e, t) {
	(typeof e != "string" || !/^[a-f0-9]{64}$/.test(e)) && V(t);
}
function W(e, t, n) {
	e !== t && V(n);
}
function Jh(e, t, n) {
	(typeof e != "string" || !t.includes(e)) && V(n);
}
function Yh(e, t, n = 0) {
	(typeof e != "number" || !Number.isSafeInteger(e) || e < n) && V(t);
}
function Xh(e, t, n) {
	(!Array.isArray(e) || Object.getPrototypeOf(e) !== Array.prototype || e.length > n || Object.getOwnPropertySymbols(e).length) && V(t);
	let r = Object.getOwnPropertyDescriptors(e);
	Object.keys(r).length !== e.length + 1 && V(t);
	for (let n = 0; n < e.length; n++) {
		let e = r[String(n)];
		(!e?.enumerable || !Object.hasOwn(e, "value")) && V(t);
	}
	return e;
}
function Zh(e, t, n = 1e4) {
	let r = Xh(e, t, n);
	return r.forEach((e, n) => Kh(e, `${t}[${n}]`)), new Set(r).size !== r.length && V(t), r;
}
function Qh(e, t) {
	let n = Xh(e, t, 64);
	return (n.some((e) => typeof e != "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(e)) || new Set(n).size !== n.length) && V(t), n;
}
function $h(e, t, n) {
	JSON.stringify([...e].sort()) !== JSON.stringify([...t].sort()) && V(n);
}
function eg(e, t) {
	if (e === t) return !0;
	if (!e || !t || typeof e != "object" || typeof t != "object" || Array.isArray(e) !== Array.isArray(t)) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => Object.hasOwn(t, n) && eg(Object.getOwnPropertyDescriptor(e, n)?.value, Object.getOwnPropertyDescriptor(t, n)?.value));
}
function tg(e) {
	return e && typeof e == "object" && (Object.values(e).forEach(tg), Object.freeze(e)), e;
}
function ng(e) {
	try {
		return tg(structuredClone(e));
	} catch {
		return V("reply.data");
	}
}
function rg(e, t, n = 4194304) {
	let r = 0;
	function i(e, t, n) {
		if ((++r > 2e5 || n > 20) && V(t), e === null || typeof e == "boolean") return;
		if (typeof e == "string") {
			U(e, t, 262144, !0);
			return;
		}
		if (typeof e == "number") {
			Number.isFinite(e) || V(t);
			return;
		}
		if (Array.isArray(e)) {
			Xh(e, t, 1e4).forEach((e, r) => i(e, `${t}[${r}]`, n + 1));
			return;
		}
		let a = Gh(e, t);
		Object.keys(a).length > 1e3 && V(t);
		for (let [e, r] of Object.entries(a)) [
			"__proto__",
			"prototype",
			"constructor"
		].includes(e) && V(t), i(r, `${t}.${e}`, n + 1);
	}
	i(e, t, 0), new TextEncoder().encode(JSON.stringify(e)).length > n && V(t);
}
function ig(e, t) {
	let n = H(e, t, [], [
		"sourceIds",
		"branch",
		"asOf",
		"onDate",
		"period"
	]);
	if (Object.hasOwn(n, "sourceIds") && Qh(n.sourceIds, `${t}.sourceIds`), Object.hasOwn(n, "branch") && U(n.branch, `${t}.branch`, 200), Object.hasOwn(n, "asOf") && (U(n.asOf, `${t}.asOf`, 64), Number.isFinite(Date.parse(n.asOf)) || V(`${t}.asOf`)), Object.hasOwn(n, "onDate") && uh(n.onDate, `${t}.onDate`), Object.hasOwn(n, "period")) {
		let e = H(n.period, `${t}.period`, ["from", "to"]);
		uh(e.from, `${t}.period.from`), uh(e.to, `${t}.period.to`), e.from > e.to && V(`${t}.period`);
	}
}
function ag(e) {
	return Kh(e, "request.id"), e;
}
function og(e) {
	return Object.freeze({ id: ag(e) });
}
function sg(e) {
	let t = H(e, "request", [
		"question",
		"purpose",
		"questionDisclosure",
		"routeId"
	], [
		"continuationId",
		"sourceIds",
		"branch",
		"asOf",
		"onDate",
		"period",
		"comparePeriod",
		"assumptions"
	]);
	U(t.question, "request.question", 8e3), W(t.purpose, "conversation", "request.purpose"), W(t.questionDisclosure, "verbatim", "request.questionDisclosure"), Kh(t.routeId, "request.routeId"), Object.hasOwn(t, "continuationId") && Kh(t.continuationId, "request.continuationId");
	let n = {};
	for (let e of [
		"sourceIds",
		"branch",
		"asOf",
		"onDate",
		"period"
	]) Object.hasOwn(t, e) && (n[e] = t[e]);
	return ig(n, "request.scope"), Eg(t, "request.calculationParameters"), rg(e, "request", 131072), ng(e);
}
function cg(e, t, n) {
	let r = H(e, n, [
		"schemaVersion",
		"turnId",
		"originalQuestion",
		"clarification",
		"sourceIds",
		"requestScope",
		"digest"
	], ["exchanges", "reviewedCalculationParameters"]);
	W(r.schemaVersion, 1, `${n}.schemaVersion`), Kh(r.turnId, `${n}.turnId`), W(r.turnId, t, `${n}.turnId`), U(r.originalQuestion, `${n}.originalQuestion`, 8e3), U(r.clarification, `${n}.clarification`, 500), qh(r.digest, `${n}.digest`), Qh(r.sourceIds, `${n}.sourceIds`), ig(r.requestScope, `${n}.requestScope`);
	let i = r.requestScope;
	if (Object.hasOwn(r, "reviewedCalculationParameters")) {
		let e = Bh(r.reviewedCalculationParameters, n + ".reviewedCalculationParameters");
		Object.hasOwn(i, "period") && !eg(e.period, i.period) && V(n + ".reviewedCalculationParameters.period");
	}
	Object.hasOwn(i, "sourceIds") && $h(i.sourceIds, r.sourceIds, `${n}.requestScope.sourceIds`), Object.hasOwn(r, "exchanges") && Xh(r.exchanges, `${n}.exchanges`, 8).forEach((e, t) => {
		let r = H(e, `${n}.exchanges[${t}]`, ["question", "clarification"]);
		U(r.question, `${n}.exchanges[${t}].question`, 8e3), U(r.clarification, `${n}.exchanges[${t}].clarification`, 500);
	}), rg(e, n, 131072);
}
function lg(e, t) {
	return Kh(t, "request.id"), cg(e, t, "continuation"), ng(e);
}
async function ug(e, t) {
	try {
		let t = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(e));
		return [...new Uint8Array(t)].map((e) => e.toString(16).padStart(2, "0")).join("");
	} catch {
		return V(t);
	}
}
async function dg(e, t) {
	let n = lg(e, t), { digest: r, ...i } = n;
	return W(await ug(JSON.stringify(i), "continuation.digest"), r, "continuation.digest"), n;
}
function fg(e, t, n) {
	U(e, t, 2e3);
	let r;
	try {
		r = new URL(e);
	} catch {
		return V(t);
	}
	if (r.protocol === "cli:") {
		(!["cli://codex/provider-managed", "cli://claude/provider-managed"].includes(e) || n !== "application-to-official-cli") && V(t);
		return;
	}
	n === "application-to-official-cli" && V(t), (r.username || r.password || r.search || r.hash || !(r.protocol === "https:" || r.protocol === "http:" && [
		"localhost",
		"127.0.0.1",
		"[::1]"
	].includes(r.hostname))) && V(t);
}
var pg = /* @__PURE__ */ "id.kind.status.purpose.createdAt.at.memberId.epoch.routeId.routeRevision.endpoint.questionDisclosure.naturalQuestion.questionHash.sourceIds.factIds.rowIds.factDigest.trustFingerprint.schema.schemaDigest.instructions.payload.digest.approvalRequired.send.receiptBoundary.providerPayloadObserved.costReservedMinor.costCurrency.experimental".split("."), mg = [
	"questionDisclosureWarning",
	"definitionDisclosure",
	"publishedCalculations",
	"definitionDisclosureWarning",
	"reviewedCalculationParameters",
	"calculationParameterOrigins",
	"calculationParametersDigest",
	"calculationParameterDisclosure",
	"calculationParameterDisclosureWarning",
	"requestScope",
	"profileSamplesHash",
	"businessContext",
	"contextDigest",
	"profileIds",
	"operations",
	"selectors"
], hg = [
	"continuationId",
	"continuationDigest",
	"continuation",
	"continuationDisclosure",
	"continuationDisclosureWarning",
	"requestScopeDigest"
], gg = [
	"toolTurnId",
	"synthesisAuthority",
	"synthesisAuthorityDigest",
	"synthesisSummary",
	"synthesisBinding",
	"synthesisInputDigest",
	"synthesisDisclosure",
	"synthesisDisclosureWarning"
], _g = [
	"id",
	"kind",
	"status",
	"purpose",
	"naturalQuestion",
	"questionDisclosure",
	"payload",
	"digest",
	"routeId",
	"endpoint",
	"approvalRequired",
	"send",
	"receiptBoundary",
	"providerPayloadObserved",
	"estimatedCostMinor",
	"costCurrency",
	"questionDisclosureWarning",
	"definitionDisclosure",
	"definitionDisclosureWarning",
	...hg.filter((e) => e !== "requestScopeDigest"),
	"reviewedCalculationParameters",
	"calculationParameterOrigins",
	"calculationParametersDigest",
	"calculationParameterDisclosure",
	"calculationParameterDisclosureWarning",
	"toolTurnId",
	"synthesisInputDigest",
	"synthesisDisclosure",
	"synthesisDisclosureWarning"
], vg = [
	"industry",
	"products",
	"customers",
	"business_model",
	"location"
], yg = [
	"workspace-metadata",
	"published-definition",
	"source-observation",
	"owner-told",
	"draft-assumption"
], bg = {
	"workspace-metadata": ["metadata-only"],
	"published-definition": ["metadata-only"],
	"source-observation": ["unqualified-observation", "evidence-qualified"],
	"owner-told": ["owner-stated"],
	"draft-assumption": ["draft"]
};
function xg(e, t, n) {
	(typeof e != "string" || typeof t != "string" || !bg[e]?.includes(t)) && V(n);
}
function Sg(e, t, n) {
	(typeof e != "string" || !RegExp(`^${t}[1-9]\\d{0,3}$`).test(e)) && V(n);
}
function Cg(e, t, n) {
	let r = Zh(e, n, 8192);
	return r.forEach((e) => Sg(e, t, n)), r;
}
function wg(e, t) {
	let n = H(e, t, [
		"schemaVersion",
		"question",
		"results",
		"evidence",
		"citationRefs"
	]);
	W(n.schemaVersion, 1, `${t}.schemaVersion`), U(n.question, `${t}.question`, 8e3);
	let r = Cg(n.citationRefs, "c", `${t}.citationRefs`), i = Xh(n.evidence, `${t}.evidence`, 64), a = Xh(n.results, `${t}.results`, 4);
	(!a.length || !i.length || r.length > 64) && V(`${t}.results`);
	let o = /* @__PURE__ */ new Map();
	i.forEach((e, n) => {
		let i = `${t}.evidence[${n}]`, a = Gh(e, i);
		if (Sg(a.ref, "e", `${i}.ref`), Sg(a.resultRef, "r", `${i}.resultRef`), o.has(a.ref) && V(`${i}.ref`), o.set(a.ref, a), a.kind === "claim") {
			H(a, i, [
				"kind",
				"ref",
				"resultRef",
				"text",
				"origin",
				"qualification",
				"citationRefs"
			]), U(a.text, `${i}.text`, 4096), Jh(a.origin, yg, `${i}.origin`), xg(a.origin, a.qualification, `${i}.qualification`);
			let e = Cg(a.citationRefs, "c", `${i}.citationRefs`);
			(!e.length || e.length > 16 || e.some((e) => !r.includes(e))) && V(`${i}.citationRefs`);
		} else a.kind === "figure" ? (H(a, i, [
			"kind",
			"ref",
			"resultRef",
			"label",
			"unit"
		], ["currency"]), U(a.label, `${i}.label`, 200), Jh(a.unit, ["money", "basis-points"], `${i}.unit`), Object.hasOwn(a, "currency") && (typeof a.currency != "string" || !/^[A-Z]{3}$/.test(a.currency)) && V(`${i}.currency`), a.unit === "money" && !Object.hasOwn(a, "currency") && V(`${i}.currency`), a.unit === "basis-points" && Object.hasOwn(a, "currency") && V(`${i}.currency`)) : a.kind === "scope" ? (H(a, i, [
			"kind",
			"ref",
			"resultRef",
			"label"
		]), U(a.label, `${i}.label`, 200)) : a.kind === "caution" ? (H(a, i, [
			"kind",
			"ref",
			"resultRef",
			"code",
			"label",
			"required"
		]), (typeof a.code != "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(a.code)) && V(`${i}.code`), U(a.label, `${i}.label`, 512), W(a.required, !0, `${i}.required`)) : V(`${i}.kind`);
	});
	let s = /* @__PURE__ */ new Set();
	a.forEach((e, n) => {
		let r = `${t}.results[${n}]`, i = H(e, r, [
			"ref",
			"tool",
			"status",
			"evidenceRefs"
		]);
		Sg(i.ref, "r", `${r}.ref`), s.has(i.ref) && V(`${r}.ref`), s.add(i.ref), Jh(i.tool, ["business.describe", "calculator.calculate"], `${r}.tool`), Jh(i.status, [
			"ok",
			"partial",
			"unavailable"
		], `${r}.status`);
		let a = Cg(i.evidenceRefs, "e", `${r}.evidenceRefs`), c = [...o.values()].filter((e) => e.resultRef === i.ref);
		(!a.length || a.length > 64 || !eg(a, c.map((e) => e.ref))) && V(`${r}.evidenceRefs`), i.status !== "ok" && !c.some((e) => e.kind === "caution") && V(`${r}.status`);
	}), [...o.values()].some((e) => !s.has(e.resultRef)) && V(`${t}.evidence`), rg(e, t, 131072);
}
function Tg(e, t) {
	wg(e.synthesisSummary, `${t}.synthesisSummary`);
	let n = e.synthesisSummary, r = H(e.synthesisBinding, `${t}.synthesisBinding`, [
		"toolTurnId",
		"plannerModelReceiptId",
		"toolResultsDigest",
		"inputDigest",
		"evidence"
	]);
	Kh(r.toolTurnId, `${t}.synthesisBinding.toolTurnId`), Kh(r.plannerModelReceiptId, `${t}.synthesisBinding.plannerModelReceiptId`), qh(r.toolResultsDigest, `${t}.synthesisBinding.toolResultsDigest`), qh(r.inputDigest, `${t}.synthesisBinding.inputDigest`), W(r.toolTurnId, e.toolTurnId, `${t}.synthesisBinding.toolTurnId`), W(r.inputDigest, e.synthesisInputDigest, `${t}.synthesisBinding.inputDigest`), W(n.question, e.naturalQuestion, `${t}.synthesisSummary.question`);
	let i = Xh(r.evidence, `${t}.synthesisBinding.evidence`, 8192), a = /* @__PURE__ */ new Set(), o = n.evidence;
	i.forEach((e, n) => {
		let r = `${t}.synthesisBinding.evidence[${n}]`, i = H(e, r, [
			"ref",
			"resultRef",
			"answerId",
			"evidenceHash",
			"renderText"
		], [
			"receiptId",
			"figureKey",
			"citationIds"
		]);
		Sg(i.ref, "e", `${r}.ref`), Sg(i.resultRef, "r", `${r}.resultRef`), Kh(i.answerId, `${r}.answerId`), qh(i.evidenceHash, `${r}.evidenceHash`), U(i.renderText, `${r}.renderText`), (a.has(i.ref) || !o.some((e) => e.ref === i.ref && e.resultRef === i.resultRef)) && V(`${r}.ref`), a.add(i.ref);
		for (let e of ["receiptId", "figureKey"]) Object.hasOwn(i, e) && Kh(i[e], `${r}.${e}`);
		Object.hasOwn(i, "citationIds") && Zh(i.citationIds, `${r}.citationIds`);
	}), a.size !== o.length && V(`${t}.synthesisBinding.evidence`);
	let s = H(e.synthesisAuthority, `${t}.synthesisAuthority`, [
		"summary",
		"binding",
		"sourceIds",
		"factIds",
		"rowIds"
	]);
	(JSON.stringify(s.summary) !== JSON.stringify(n) || JSON.stringify(s.binding) !== JSON.stringify(r)) && V(`${t}.synthesisAuthority`);
	for (let n of [
		"sourceIds",
		"factIds",
		"rowIds"
	]) $h(Zh(s[n], `${t}.synthesisAuthority.${n}`), e[n], `${t}.synthesisAuthority.${n}`);
}
function Eg(e, t) {
	let n = {};
	for (let t of Nh) Object.hasOwn(e, t) && (n[t] = e[t]);
	return Bh(n, t);
}
function Dg(e, t) {
	let n = "preview", r = Bh(e.reviewedCalculationParameters, n + ".reviewedCalculationParameters"), i = Vh(e.calculationParameterOrigins, r, n + ".calculationParameterOrigins"), a = Eg(t, "request.calculationParameters"), o = e.continuation, s = o?.requestScope, c = Bh(o?.reviewedCalculationParameters ?? (s?.period === void 0 ? {} : { period: s.period }), n + ".continuation.reviewedCalculationParameters"), l = {}, u = {};
	for (let e of Nh) {
		c[e] !== void 0 && a[e] !== void 0 && !eg(c[e], a[e]) && V(n + ".reviewedCalculationParameters." + e);
		let t = c[e] ?? a[e];
		t !== void 0 && (l[e] = t, u[e] = c[e] === void 0 ? "owner-requested" : "retained-owner-requested");
	}
	(!eg(r, l) || !eg(i, u)) && V(n + ".reviewedCalculationParameters");
	let d = e.requestScope;
	Object.hasOwn(d, "period") && !eg(r.period, d.period) && V(n + ".requestScope.period"), Uh(e.calculationParameterDisclosure, r, i, n + ".calculationParameterDisclosure"), qh(e.calculationParametersDigest, n + ".calculationParametersDigest"), U(e.calculationParameterDisclosureWarning, n + ".calculationParameterDisclosureWarning");
}
function Og(e, t) {
	let n = "preview", r = Gh(e, n).purpose === "conversation-synthesis", i = H(e, n, [...pg, ...r ? gg : mg], ["estimatedCostMinor", ...r ? [] : hg]);
	W(i.kind, "model-preview", `${n}.kind`), W(i.status, "preview", `${n}.status`), Jh(i.purpose, ["conversation", "conversation-synthesis"], `${n}.purpose`);
	for (let e of [
		"id",
		"memberId",
		"routeId"
	]) Kh(i[e], `${n}.${e}`);
	for (let e of ["epoch", "routeRevision"]) Yh(i[e], `${n}.${e}`, 1);
	for (let e of ["createdAt", "at"]) dh(i[e], `${n}.${e}`);
	for (let e of [
		"questionHash",
		"factDigest",
		"trustFingerprint",
		"schemaDigest",
		"digest"
	]) qh(i[e], `${n}.${e}`);
	W(i.questionDisclosure, "verbatim", `${n}.questionDisclosure`), U(i.naturalQuestion, `${n}.naturalQuestion`, 8e3), U(i.instructions, `${n}.instructions`, 262144), U(i.payload, `${n}.payload`, 262144), new TextEncoder().encode(i.payload).length > 262144 && V(`${n}.payload`), W(i.approvalRequired, !0, `${n}.approvalRequired`), W(i.costReservedMinor, "0", `${n}.costReservedMinor`), W(i.costCurrency, "INR", `${n}.costCurrency`), W(i.experimental, !0, `${n}.experimental`), Jh(i.send, ["shape", "samples"], `${n}.send`), Jh(i.receiptBoundary, ["application-to-official-cli", "application-to-provider-http"], `${n}.receiptBoundary`), W(i.providerPayloadObserved, i.receiptBoundary === "application-to-provider-http", `${n}.providerPayloadObserved`);
	for (let e of [
		"sourceIds",
		"factIds",
		"rowIds"
	]) Zh(i[e], `${n}.${e}`);
	if (Object.hasOwn(i, "endpoint") && fg(i.endpoint, `${n}.endpoint`, i.receiptBoundary), Object.hasOwn(i, "estimatedCostMinor") && (typeof i.estimatedCostMinor != "string" || !/^\d{1,256}$/.test(i.estimatedCostMinor)) && V(`${n}.estimatedCostMinor`), r) {
		let e = Pg(t.id, t.routeId);
		Kh(i.toolTurnId, `${n}.toolTurnId`), W(i.toolTurnId, e.id, `${n}.toolTurnId`), e.routeId !== void 0 && W(i.routeId, e.routeId, `${n}.routeId`), W(i.send, "samples", `${n}.send`), W(i.synthesisDisclosure, "admitted-tool-summary", `${n}.synthesisDisclosure`), U(i.synthesisDisclosureWarning, `${n}.synthesisDisclosureWarning`), qh(i.synthesisInputDigest, `${n}.synthesisInputDigest`), qh(i.synthesisAuthorityDigest, `${n}.synthesisAuthorityDigest`), Tg(i, n);
	} else {
		let e = sg(t);
		W(i.naturalQuestion, e.question, `${n}.naturalQuestion`), W(i.routeId, e.routeId, `${n}.routeId`), U(i.questionDisclosureWarning, `${n}.questionDisclosureWarning`), U(i.definitionDisclosureWarning, `${n}.definitionDisclosureWarning`), W(i.definitionDisclosure, "published", `${n}.definitionDisclosure`);
		for (let e of ["contextDigest", "profileSamplesHash"]) qh(i[e], `${n}.${e}`);
		Zh(i.profileIds, `${n}.profileIds`), ig(i.requestScope, `${n}.requestScope`);
		let r = i.requestScope;
		for (let t of [
			"sourceIds",
			"branch",
			"asOf",
			"onDate",
			"period"
		]) e[t] !== void 0 && (t === "sourceIds" ? $h(r[t] ?? [], e[t], `${n}.requestScope.${t}`) : t === "asOf" ? (typeof r[t] != "string" || Date.parse(r[t]) !== Date.parse(e[t])) && V(`${n}.requestScope.${t}`) : JSON.stringify(r[t]) !== JSON.stringify(e[t]) && V(`${n}.requestScope.${t}`));
		let a = hg.some((e) => Object.hasOwn(i, e));
		a !== (e.continuationId !== void 0) && V(`${n}.continuationId`), a && (hg.some((e) => !Object.hasOwn(i, e)) && V(`${n}.continuation`), W(i.continuationId, e.continuationId, `${n}.continuationId`), cg(i.continuation, e.continuationId, `${n}.continuation`), W(i.continuationDigest, i.continuation.digest, `${n}.continuationDigest`), W(i.continuationDisclosure, "verbatim", `${n}.continuationDisclosure`), qh(i.requestScopeDigest, `${n}.requestScopeDigest`), U(i.continuationDisclosureWarning, `${n}.continuationDisclosureWarning`)), Dg(i, e);
	}
	rg(e, n);
	let a = {};
	for (let e of _g) Object.hasOwn(i, e) && (a[e] = i[e]);
	let o = ng(a);
	return Wh.set(o, r ? {
		verified: !1,
		summary: ng(i.synthesisSummary),
		binding: ng(i.synthesisBinding)
	} : {
		verified: !1,
		request: sg(t)
	}), o;
}
async function kg(e, t) {
	let n = Og(e, t), r = ng(e);
	W(await ug(n.payload, "preview.digest"), n.digest, "preview.digest"), W(await ug(n.naturalQuestion, "preview.questionHash"), r.questionHash, "preview.questionHash"), W(await ug(JSON.stringify(r.schema), "preview.schemaDigest"), r.schemaDigest, "preview.schemaDigest");
	let i;
	try {
		if (n.receiptBoundary === "application-to-official-cli") {
			let e = `${r.instructions}\n`;
			n.payload.startsWith(e) || V("preview.payload.instructions"), i = n.payload.slice(e.length);
		} else {
			let e = Gh(JSON.parse(n.payload), "preview.payload");
			if (Object.hasOwn(e, "messages")) {
				Object.hasOwn(e, "input") && V("preview.payload");
				let t = Xh(e.messages, "preview.payload.messages", 2);
				t.length !== 2 && V("preview.payload.messages");
				let n = H(t[0], "preview.payload.messages[0]", ["role", "content"]), a = H(t[1], "preview.payload.messages[1]", ["role", "content"]);
				W(n.role, "system", "preview.payload.messages[0].role"), W(n.content, r.instructions, "preview.payload.instructions"), W(a.role, "user", "preview.payload.messages[1].role"), i = a.content;
			} else W(e.instructions, r.instructions, "preview.payload.instructions"), i = e.input;
		}
		U(i, "preview.payload.input", 262144), i = JSON.parse(i);
	} catch {
		V("preview.payload.input");
	}
	rg(i, "preview.payload.input", 262144);
	let a = Gh(i, "preview.payload.input");
	if (n.purpose === "conversation-synthesis") {
		W(await ug(JSON.stringify(r.synthesisSummary), "preview.synthesisInputDigest"), n.synthesisInputDigest, "preview.synthesisInputDigest"), W(await ug(JSON.stringify(r.synthesisAuthority), "preview.synthesisAuthorityDigest"), r.synthesisAuthorityDigest, "preview.synthesisAuthorityDigest"), W(await ug(JSON.stringify(a), "preview.payload.input"), n.synthesisInputDigest, "preview.payload.input");
		let e = r.synthesisSummary.evidence;
		for (let t of r.synthesisBinding.evidence) {
			let { ref: n, resultRef: r, ...i } = e.find((e) => e.ref === t.ref), a = Object.fromEntries(Object.entries(t).filter(([e]) => [
				"receiptId",
				"figureKey",
				"citationIds"
			].includes(e)));
			W(await ug(JSON.stringify({
				item: i,
				renderText: t.renderText,
				metadata: a
			}), "preview.synthesisBinding.evidenceHash"), t.evidenceHash, "preview.synthesisBinding.evidenceHash");
		}
	} else {
		let e = Bh(r.reviewedCalculationParameters, "preview.reviewedCalculationParameters"), t = Vh(r.calculationParameterOrigins, e, "preview.calculationParameterOrigins");
		if (W(await ug(JSON.stringify(r.reviewedCalculationParameters), "preview.calculationParametersDigest"), r.calculationParametersDigest, "preview.calculationParametersDigest"), Uh(a.calculationParameters, e, t, "preview.payload.calculationParameters"), W(await ug(JSON.stringify(a.calculationParameters), "preview.payload.calculationParameters"), await ug(JSON.stringify(r.calculationParameterDisclosure), "preview.calculationParameterDisclosure"), "preview.payload.calculationParameters"), W(a.question, n.naturalQuestion, "preview.payload.question"), W(a.questionDisclosure, "verbatim", "preview.payload.questionDisclosure"), n.continuation) {
			let { turnId: e, originalQuestion: t, clarification: i, exchanges: o } = await dg(n.continuation, n.continuation.turnId);
			W(a.continuationDisclosure, "verbatim", "preview.payload.continuationDisclosure"), W(await ug(JSON.stringify(a.continuation), "preview.payload.continuation"), await ug(JSON.stringify({
				turnId: e,
				originalQuestion: t,
				clarification: i,
				...o === void 0 ? {} : { exchanges: o }
			}), "preview.continuation"), "preview.payload.continuation"), W(await ug(JSON.stringify(r.requestScope), "preview.requestScopeDigest"), r.requestScopeDigest, "preview.requestScopeDigest");
			let s = Gh(r.businessContext, "preview.businessContext");
			ig(s.request, "preview.businessContext.request"), W(await ug(JSON.stringify(r.requestScope), "preview.requestScopeDigest"), await ug(JSON.stringify(s.request), "preview.businessContext.request"), "preview.requestScopeDigest");
		} else (Object.hasOwn(a, "continuation") || Object.hasOwn(a, "continuationDisclosure")) && V("preview.payload.continuation");
	}
	return Wh.get(n).verified = !0, n;
}
function Ag(e, t) {
	let n = H(e, "approval", [
		"id",
		"kind",
		"previewId",
		"digest",
		"routeId",
		"endpoint",
		"approverId",
		"approverEpoch",
		"createdAt",
		"expiresAt",
		"used"
	]);
	for (let e of [
		"id",
		"previewId",
		"routeId",
		"approverId"
	]) Kh(n[e], `approval.${e}`);
	return qh(n.digest, "approval.digest"), W(n.kind, "outbound-approval", "approval.kind"), W(n.used, !1, "approval.used"), Yh(n.approverEpoch, "approval.approverEpoch", 1), dh(n.createdAt, "approval.createdAt"), dh(n.expiresAt, "approval.expiresAt"), Date.parse(n.expiresAt) <= Date.parse(n.createdAt) && V("approval.expiresAt"), Object.hasOwn(n, "endpoint") && fg(n.endpoint, "approval.endpoint", t.receiptBoundary), W(n.previewId, t.id, "approval.previewId"), W(n.digest, t.digest, "approval.digest"), W(n.routeId, t.routeId, "approval.routeId"), W(n.endpoint, t.endpoint, "approval.endpoint"), ng(e);
}
function jg(e) {
	let t = Wh.get(e);
	return t?.verified || V("preview.verification"), t;
}
function Mg(e) {
	return jg(e), og(e.id);
}
function Ng(e, t, n) {
	let r = sg(e);
	return W(t.purpose, "conversation", "request.preview.purpose"), W(t.naturalQuestion, r.question, "request.preview.question"), W(t.routeId, r.routeId, "request.preview.routeId"), eg(jg(t).request, r) || V("request.preview.scope"), W(t.continuationId, r.continuationId, "request.preview.continuationId"), Ag(n, t), ng({
		...r,
		previewId: t.id,
		approvalId: n.id
	});
}
function Pg(e, t) {
	let n = { id: ag(e) };
	return t !== void 0 && (Kh(t, "request.routeId"), n.routeId = t), Object.freeze(n);
}
function Fg(e, t, n) {
	jg(t);
	let r = ag(e);
	return W(t.purpose, "conversation-synthesis", "request.preview.purpose"), W(t.toolTurnId, r, "request.preview.toolTurnId"), Ag(n, t), Object.freeze({
		id: r,
		previewId: t.id,
		approvalId: n.id
	});
}
function Ig(e, t, n) {
	let r = H(e, t, [
		"id",
		"kind",
		"status",
		"message",
		"claims",
		"citations",
		"unknowns",
		"conflicts",
		"scope",
		"contextDigest",
		"sourceIds",
		"rowIds",
		"profileIds",
		"receipt"
	]);
	Kh(r.id, `${t}.id`), W(r.kind, "business-context", `${t}.kind`), Jh(r.status, [
		"grounded",
		"partial",
		"unknown"
	], `${t}.status`), U(r.message, `${t}.message`, 2e4, !0), qh(r.contextDigest, `${t}.contextDigest`);
	for (let e of [
		"sourceIds",
		"rowIds",
		"profileIds"
	]) Zh(r[e], `${t}.${e}`, 256);
	let i = Xh(r.citations, `${t}.citations`, 256), a = /* @__PURE__ */ new Set();
	i.forEach((e, n) => {
		let r = `${t}.citations[${n}]`, i = H(e, r, [
			"id",
			"kind",
			"referenceId",
			"path",
			"contentHash"
		], [
			"sourceId",
			"factId",
			"sourceRow",
			"branch",
			"validFrom",
			"validTo",
			"learnedAt"
		]);
		for (let e of ["id", "referenceId"]) Kh(i[e], `${r}.${e}`);
		U(i.path, `${r}.path`), qh(i.contentHash, `${r}.contentHash`), Jh(i.kind, [
			"workspace",
			"dictionary",
			"fact",
			"profile"
		], `${r}.kind`), a.has(i.id) && V(`${r}.id`), a.add(i.id);
		for (let e of [
			"sourceId",
			"factId",
			"branch"
		]) Object.hasOwn(i, e) && U(i[e], `${r}.${e}`, 200);
		Object.hasOwn(i, "sourceRow") && Yh(i.sourceRow, `${r}.sourceRow`, 1), Object.hasOwn(i, "validFrom") && uh(i.validFrom, `${r}.validFrom`), Object.hasOwn(i, "validTo") && i.validTo !== null && uh(i.validTo, `${r}.validTo`), Object.hasOwn(i, "learnedAt") && dh(i.learnedAt, `${r}.learnedAt`);
	});
	let o = /* @__PURE__ */ new Set(), s = /* @__PURE__ */ new Set(), c = Xh(r.claims, `${t}.claims`, 16);
	c.forEach((e, n) => {
		let r = `${t}.claims[${n}]`, i = H(e, r, [
			"id",
			"category",
			"text",
			"origin",
			"qualification",
			"citationIds"
		]);
		Kh(i.id, `${r}.id`), U(i.text, `${r}.text`), Jh(i.category, [
			"workspace",
			"definitions",
			"records",
			...vg
		], `${r}.category`), Jh(i.origin, yg, `${r}.origin`), xg(i.origin, i.qualification, `${r}.qualification`), o.has(i.id) && V(`${r}.id`), o.add(i.id);
		let c = Zh(i.citationIds, `${r}.citationIds`, 256);
		(!c.length || c.some((e) => !a.has(e))) && V(`${r}.citationIds`), c.forEach((e) => s.add(e));
	}), s.size !== a.size && V(`${t}.citations`);
	let l = /* @__PURE__ */ new Set(), u = Xh(r.unknowns, `${t}.unknowns`, 5);
	u.forEach((e, n) => {
		let r = `${t}.unknowns[${n}]`, i = H(e, r, ["category", "message"]);
		Jh(i.category, vg, `${r}.category`), U(i.message, `${r}.message`), l.has(i.category) && V(`${r}.category`), l.add(i.category), W(i.message, `I do not have an established ${i.category.replaceAll("_", " ")} description in the currently permitted evidence.`, `${r}.message`);
	});
	let d = Xh(r.conflicts, `${t}.conflicts`, 256);
	d.forEach((e, n) => {
		let r = `${t}.conflicts[${n}]`, i = H(e, r, [
			"category",
			"citationIds",
			"reason"
		]);
		Jh(i.category, ["records", ...vg], `${r}.category`), Zh(i.citationIds, `${r}.citationIds`, 256).length || V(`${r}.citationIds`), U(i.reason, `${r}.reason`);
	});
	let f = H(r.scope, `${t}.scope`, [
		"branch",
		"asOf",
		"onDate",
		"syntheticFixture",
		"corpus",
		"completeness",
		"limitations"
	]);
	f.branch !== null && U(f.branch, `${t}.scope.branch`, 200), dh(f.asOf, `${t}.scope.asOf`), uh(f.onDate, `${t}.scope.onDate`), typeof f.syntheticFixture != "boolean" && V(`${t}.scope.syntheticFixture`), W(f.corpus, "currently-authorized-local-evidence", `${t}.scope.corpus`), W(f.completeness, "bounded", `${t}.scope.completeness`);
	let p = Xh(f.limitations, `${t}.scope.limitations`, 4);
	(p.length !== 3 && p.length !== 4 || [
		"Only currently permitted, retained local evidence was searched.",
		"Absence in this context does not establish absence elsewhere.",
		"Owner statements and draft assumptions are not verified financial results."
	].some((e, t) => p[t] !== e) || p.length === 4 && p[3] !== "Imported-record context is bounded; no exhaustive source coverage is claimed.") && V(`${t}.scope.limitations`);
	let m = c.some((e) => e.origin === "owner-told"), h = c.some((e) => ["draft", "unqualified-observation"].includes(e.qualification));
	W(r.status, m ? u.length || d.length || h ? "partial" : "grounded" : "unknown", `${t}.status`);
	let g = [
		...c.map((e) => e.text),
		...u.map((e) => e.message),
		...d.length ? ["Some permitted source claims conflict, so they were not treated as established business facts."] : []
	].join("\n");
	W(r.message, g, `${t}.message`);
	let _ = H(r.receipt, `${t}.receipt`, [
		"id",
		"kind",
		"contextDigest",
		"financialCalculation",
		"sourceIds",
		"rowIds"
	], ["modelReceiptId"]);
	W(_.id, r.id, `${t}.receipt.id`), W(_.kind, "business-context-receipt", `${t}.receipt.kind`), W(_.contextDigest, r.contextDigest, `${t}.receipt.contextDigest`), W(_.financialCalculation, !1, `${t}.receipt.financialCalculation`);
	for (let e of ["sourceIds", "rowIds"]) $h(Zh(_[e], `${t}.receipt.${e}`, 256), r[e], `${t}.receipt.${e}`);
	return Object.hasOwn(_, "modelReceiptId") && Kh(_.modelReceiptId, `${t}.receipt.modelReceiptId`), n !== void 0 && W(_.modelReceiptId, n, `${t}.receipt.modelReceiptId`), rg(e, t, 131072), ng(e);
}
function Lg(e, t, n = 512) {
	let r = H(e, t, [
		"id",
		"kind",
		"modelReceiptId",
		"results",
		"receipt"
	]);
	Kh(r.id, `${t}.id`), Kh(r.modelReceiptId, `${t}.modelReceiptId`), W(r.kind, "grounded-conversation", `${t}.kind`);
	let i = Xh(r.results, `${t}.results`, 4);
	i.length || V(`${t}.results`);
	let a = i.map((e, i) => {
		let a = `${t}.results[${i}]`, o = Gh(e, a);
		if (Jh(o.tool, ["business.describe", "calculator.calculate"], `${a}.tool`), Object.hasOwn(o, "error")) {
			H(o, a, ["tool", "error"]);
			let e = H(o.error, `${a}.error`, ["code", "message"]);
			return (typeof e.code != "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(e.code)) && V(`${a}.error.code`), U(e.message, `${a}.error.message`, n), ng(o);
		}
		if (H(o, a, ["tool", "answer"]), o.tool === "business.describe") return {
			tool: "business.describe",
			answer: Ig(o.answer, `${a}.answer`, r.modelReceiptId)
		};
		let s = Mh(o.answer);
		return s.stale && V(`${a}.answer.stale`), {
			tool: "calculator.calculate",
			answer: s
		};
	}), o = H(r.receipt, `${t}.receipt`, [
		"id",
		"kind",
		"modelReceiptId",
		"resultRefs"
	]);
	W(o.id, r.id, `${t}.receipt.id`), W(o.kind, "conversation-tool-receipt", `${t}.receipt.kind`), W(o.modelReceiptId, r.modelReceiptId, `${t}.receipt.modelReceiptId`);
	let s = Xh(o.resultRefs, `${t}.receipt.resultRefs`, 4), c = a.filter((e) => !e.error), l = /* @__PURE__ */ new Set();
	return s.length !== c.length && V(`${t}.receipt.resultRefs`), s.forEach((e, n) => {
		let r = `${t}.receipt.resultRefs[${n}]`, i = H(e, r, ["tool", "answerId"]);
		W(i.tool, c[n]?.tool, `${r}.tool`), Kh(i.answerId, `${r}.answerId`), l.has(i.answerId) && V(`${r}.answerId`), l.add(i.answerId);
		let a = c[n];
		a?.tool === "business.describe" && W(i.answerId, a.answer?.id, `${r}.answerId`);
	}), ng({
		...r,
		results: a
	});
}
function Rg(e, t, n = 512) {
	let r = H(e, t, [
		"id",
		"kind",
		"paragraphs",
		"cautions",
		"references",
		"tools",
		"receipt"
	]);
	Kh(r.id, `${t}.id`), W(r.kind, "synthesized-conversation", `${t}.kind`);
	let i = Xh(r.paragraphs, `${t}.paragraphs`, 12);
	i.length || V(`${t}.paragraphs`), i.forEach((e, n) => U(e, `${t}.paragraphs[${n}]`));
	let a = Lg(r.tools, `${t}.tools`, n), o = H(r.receipt, `${t}.receipt`, [
		"id",
		"kind",
		"toolTurnId",
		"plannerModelReceiptId",
		"synthesisModelReceiptId",
		"inputDigest",
		"outputDigest"
	]);
	W(o.id, r.id, `${t}.receipt.id`), W(o.kind, "conversation-synthesis-receipt", `${t}.receipt.kind`), W(o.toolTurnId, a.id, `${t}.receipt.toolTurnId`), W(o.plannerModelReceiptId, a.modelReceiptId, `${t}.receipt.plannerModelReceiptId`), Kh(o.synthesisModelReceiptId, `${t}.receipt.synthesisModelReceiptId`), qh(o.inputDigest, `${t}.receipt.inputDigest`), qh(o.outputDigest, `${t}.receipt.outputDigest`);
	let s = /* @__PURE__ */ new Set([a.id, ...a.receipt.resultRefs.map((e) => e.answerId)]), c = /* @__PURE__ */ new Set(), l = /* @__PURE__ */ new Set();
	a.results.forEach((e) => {
		e.error || (e.tool === "calculator.calculate" ? c.add(e.answer.id) : e.answer.citations.forEach((e) => l.add(e.id)));
	});
	let u = Xh(r.references, `${t}.references`, 12);
	u.length !== i.length && V(`${t}.references`), u.forEach((e, n) => {
		let r = `${t}.references[${n}]`, i = H(e, r, [
			"evidenceRefs",
			"answerIds",
			"receiptIds",
			"citationIds"
		]), a = Cg(i.evidenceRefs, "e", `${r}.evidenceRefs`), o = Zh(i.answerIds, `${r}.answerIds`, 5);
		(!a.length || !o.length || o.some((e) => !s.has(e))) && V(r), (Zh(i.receiptIds, `${r}.receiptIds`, 4).some((e) => !c.has(e)) || Zh(i.citationIds, `${r}.citationIds`, 256).some((e) => !l.has(e))) && V(r);
	});
	let d = /* @__PURE__ */ new Set();
	return Xh(r.cautions, `${t}.cautions`, 8192).forEach((e, n) => {
		let r = `${t}.cautions[${n}]`, i = H(e, r, ["ref", "text"]);
		Sg(i.ref, "e", `${r}.ref`), U(i.text, `${r}.text`), d.has(i.ref) && V(`${r}.ref`), d.add(i.ref);
	}), ng({
		...r,
		tools: a
	});
}
function zg(e, t) {
	let n = H(e, t, ["clarification", "modelReceiptId"]);
	return U(n.clarification, `${t}.clarification`, 500), Kh(n.modelReceiptId, `${t}.modelReceiptId`), ng(e);
}
function Bg(e, t = {}) {
	return Vg(e, t, 512);
}
function Vg(e, t, n) {
	rg(e, "answer");
	let r = Gh(e, "answer"), i;
	i = r.kind === "grounded-conversation" ? Lg(e, "answer", n) : r.kind === "synthesized-conversation" ? Rg(e, "answer", n) : zg(e, "answer");
	let a = "modelReceiptId" in i ? i.modelReceiptId : i.receipt.plannerModelReceiptId;
	if (t.modelReceiptId !== void 0 && W(a, t.modelReceiptId, "answer.modelReceiptId"), (t.toolTurnId !== void 0 || t.synthesisModelReceiptId !== void 0 || t.inputDigest !== void 0) && ((!("kind" in i) || i.kind !== "synthesized-conversation") && V("answer.kind"), t.toolTurnId !== void 0 && W(i.receipt.toolTurnId, t.toolTurnId, "answer.receipt.toolTurnId"), t.synthesisModelReceiptId !== void 0 && W(i.receipt.synthesisModelReceiptId, t.synthesisModelReceiptId, "answer.receipt.synthesisModelReceiptId"), t.inputDigest !== void 0 && W(i.receipt.inputDigest, t.inputDigest, "answer.receipt.inputDigest")), t.preview !== void 0) {
		let e = t.preview, n = jg(e);
		if (e.purpose === "conversation") W(a, e.id, "answer.modelReceiptId");
		else {
			(!("kind" in i) || i.kind !== "synthesized-conversation" || !n.summary || !n.binding) && V("answer.kind"), W(i.receipt.synthesisModelReceiptId, e.id, "answer.receipt.synthesisModelReceiptId"), W(i.receipt.toolTurnId, e.toolTurnId, "answer.receipt.toolTurnId"), W(i.receipt.inputDigest, e.synthesisInputDigest, "answer.receipt.inputDigest"), W(i.receipt.plannerModelReceiptId, n.binding.plannerModelReceiptId, "answer.receipt.plannerModelReceiptId");
			let t = n.summary.evidence, r = n.binding.evidence, a = t.filter((e) => e.kind === "caution").map((e) => ({
				ref: e.ref,
				text: r.find((t) => t.ref === e.ref)?.renderText
			}));
			eg(i.cautions, a) || V("answer.cautions");
			let o = new Set(i.references.flatMap((e) => e.evidenceRefs));
			t.filter((e) => e.kind === "figure" || e.kind === "scope").some((e) => !o.has(e.ref)) && V("answer.references.coverage"), i.references.forEach((e, t) => {
				let n = e.evidenceRefs.map((e) => {
					let n = r.find((t) => t.ref === e);
					return n || V(`answer.references[${t}].evidenceRefs`), n;
				});
				for (let [r, i] of [
					["answerIds", n.map((e) => e.answerId)],
					["receiptIds", n.flatMap((e) => e.receiptId ? [e.receiptId] : [])],
					["citationIds", n.flatMap((e) => e.citationIds ?? [])]
				]) $h(e[r], [...new Set(i)], `answer.references[${t}].${r}`);
			});
		}
	}
	return i;
}
async function Hg(e, t = {}) {
	let n = Bg(e, t);
	if (t.preview?.purpose === "conversation-synthesis") {
		let n = ng(e), r = jg(t.preview);
		W(await ug(JSON.stringify(n.tools), "answer.tools.digest"), r.binding?.toolResultsDigest, "answer.tools.digest");
	}
	return n;
}
function Ug(e, t) {
	Kh(t, "request.id"), rg(e, "readback");
	let n = H(e, "readback", [
		"id",
		"at",
		"question",
		"kind",
		"answer"
	]);
	Kh(n.id, "readback.id"), dh(n.at, "readback.at"), U(n.question, "readback.question", 8e3);
	let r;
	if (n.kind === "business-context") r = Ig(n.answer, "readback.answer");
	else if (n.kind === "calculation") {
		let e = Gh(n.answer, "readback.answer");
		if (Object.hasOwn(e, "supported")) {
			H(e, "readback.answer", [
				"supported",
				"message",
				"receipt"
			]), W(e.supported, !0, "readback.answer.supported"), U(e.message, "readback.answer.message");
			let t = Mh(e.receipt);
			t.stale && V("readback.answer.receipt.stale"), W(e.message, t.explanation, "readback.answer.message"), r = {
				supported: !0,
				message: e.message,
				receipt: t
			};
		} else r = Mh(e), r.stale && V("readback.answer.stale");
	} else Jh(n.kind, [
		"clarification",
		"grounded-conversation",
		"synthesized-conversation"
	], "readback.kind"), r = Vg(n.answer, {}, 2e3), W(n.kind, "kind" in r ? r.kind : "clarification", "readback.kind");
	return n.id !== t && !(n.kind === "clarification" && "modelReceiptId" in r && r.modelReceiptId === t) && V("readback.id"), [
		"business-context",
		"grounded-conversation",
		"synthesized-conversation"
	].includes(n.kind) && W(r.id, n.id, "readback.answer.id"), ng({
		...n,
		answer: r
	});
}
//#endregion
//#region app/ui/src/app/conversation-surface.ts
var Wg = "model-consent";
function Gg(e) {
	return Kn(e, Wg);
}
function Kg(e) {
	return Gn(e);
}
function qg(e, t) {
	return e !== null && t !== null && Wn(e, t);
}
function Jg(e, t) {
	if (t || !Qn(e, "ask", "new")) return null;
	let n = {
		place: "ask",
		sub: "new"
	}, r = ur(e, n);
	return r !== null && Wn(n, r) ? r : null;
}
function Yg(e, t, n) {
	if (n || t === null || t.place !== "ask" || t.sub !== void 0 && t.sub !== "new" && t.sub !== "saved") return null;
	let r = ur(e, t);
	return r !== null && Wn(t, r) ? r : null;
}
function Xg(e, t) {
	let n = Tr(t);
	if (n === null) return null;
	let r = sg({
		...e,
		question: n
	});
	if (r.continuationId !== void 0) throw TypeError("CONTINUATION_HOST_OWNED");
	return r;
}
//#endregion
//#region app/ui/src/patterns/model-disclosure-translation.ts
var Zg = {
	question: "The complete question is included separately from evidence Shape. Review it for private names, amounts and instructions before approving.",
	definition: "Published calculation labels, definitions and parameter meanings are included separately from evidence Shape. Review definition text for private names, amounts and instructions before approving this exact payload.",
	continuation: "The complete retained original objective, clarification and any prior exchanges are included separately from evidence Shape, with your exact current reply. Review all prior text for private names, amounts and instructions before approving this exact payload.",
	synthesis: "The exact retained original objective, admitted claim text and derived tool summary are included separately from evidence Shape. Review private names, business details and instructions before approving this separate synthesis transfer once."
};
function Qg(e, t) {
	return t === Zg[e] ? `ASK.consent.disclosure.${e}` : void 0;
}
var G = {
	note: "_note_13we6_3",
	block: "_block_13we6_10",
	label: "_label_13we6_16",
	exact: "_exact_13we6_24",
	pairs: "_pairs_13we6_30",
	pair: "_pair_13we6_30",
	name: "_name_13we6_43",
	value: "_value_13we6_49",
	exchanges: "_exchanges_13we6_57",
	exchange: "_exchange_13we6_57",
	payload: "_payload_13we6_71"
}, $g = {
	conversation: "planning",
	"conversation-synthesis": "final-writing"
};
function e_({ title: e, children: t }) {
	return /* @__PURE__ */ (0, A.jsxs)("section", {
		className: G.block,
		children: [/* @__PURE__ */ (0, A.jsx)("h3", {
			className: G.label,
			children: e
		}), t]
	});
}
function t_({ name: e, mono: t = !1, exact: n = !1, children: r }) {
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: G.pair,
		children: [/* @__PURE__ */ (0, A.jsx)("dt", {
			className: G.name,
			children: e
		}), /* @__PURE__ */ (0, A.jsx)("dd", {
			className: [
				G.value,
				t ? "fig" : "",
				n ? G.exact : ""
			].filter(Boolean).join(" "),
			children: r
		})]
	});
}
function n_({ family: e, warning: t }) {
	let n = j(), r = In() === "hi" ? Qg(e, t) : void 0;
	return /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [r !== void 0 && /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)("p", {
		className: G.exact,
		lang: "hi",
		children: n(r)
	}), /* @__PURE__ */ (0, A.jsx)("p", {
		className: G.name,
		children: n("ASK.consent.disclosure.original")
	})] }), /* @__PURE__ */ (0, A.jsx)("p", {
		className: G.exact,
		lang: r === void 0 ? void 0 : "en",
		children: t
	})] });
}
function r_({ preview: e }) {
	let t = j(), n = (0, _.useId)(), r = e.continuation;
	return /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [
		/* @__PURE__ */ (0, A.jsx)(e_, {
			title: t("ASK.consent.warning.question"),
			children: /* @__PURE__ */ (0, A.jsx)(n_, {
				family: "question",
				warning: e.questionDisclosureWarning
			})
		}),
		/* @__PURE__ */ (0, A.jsx)(e_, {
			title: t("ASK.consent.warning.definition"),
			children: /* @__PURE__ */ (0, A.jsx)(n_, {
				family: "definition",
				warning: e.definitionDisclosureWarning
			})
		}),
		/* @__PURE__ */ (0, A.jsx)(e_, {
			title: t("ASK.consent.warning.calculation"),
			children: /* @__PURE__ */ (0, A.jsx)("p", {
				className: G.exact,
				lang: "en",
				children: e.calculationParameterDisclosureWarning
			})
		}),
		e.continuationDisclosureWarning !== void 0 && /* @__PURE__ */ (0, A.jsx)(e_, {
			title: t("ASK.consent.warning.continuation"),
			children: /* @__PURE__ */ (0, A.jsx)(n_, {
				family: "continuation",
				warning: e.continuationDisclosureWarning
			})
		}),
		r !== void 0 && /* @__PURE__ */ (0, A.jsxs)(e_, {
			title: t("ASK.consent.earlier"),
			children: [/* @__PURE__ */ (0, A.jsxs)("dl", {
				className: G.pairs,
				children: [/* @__PURE__ */ (0, A.jsx)(t_, {
					name: t("ASK.consent.earlier.question"),
					exact: !0,
					children: r.originalQuestion
				}), /* @__PURE__ */ (0, A.jsx)(t_, {
					name: t("ASK.consent.earlier.clarification"),
					exact: !0,
					children: r.clarification
				})]
			}), r.exchanges !== void 0 && r.exchanges.length > 0 && /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)("p", {
				id: n,
				className: G.name,
				children: t("ASK.consent.earlier.exchanges")
			}), /* @__PURE__ */ (0, A.jsx)("ol", {
				className: G.exchanges,
				"aria-labelledby": n,
				children: r.exchanges.map((e, n) => /* @__PURE__ */ (0, A.jsx)("li", {
					className: G.exchange,
					children: /* @__PURE__ */ (0, A.jsxs)("dl", {
						className: G.pairs,
						children: [/* @__PURE__ */ (0, A.jsx)(t_, {
							name: t("ASK.consent.exchange.question"),
							exact: !0,
							children: e.question
						}), /* @__PURE__ */ (0, A.jsx)(t_, {
							name: t("ASK.consent.exchange.clarification"),
							exact: !0,
							children: e.clarification
						})]
					})
				}, n))
			})] })]
		})
	] });
}
function i_({ preview: e }) {
	let t = j();
	return /* @__PURE__ */ (0, A.jsx)(e_, {
		title: t("ASK.consent.warning.synthesis"),
		children: /* @__PURE__ */ (0, A.jsx)(n_, {
			family: "synthesis",
			warning: e.synthesisDisclosureWarning
		})
	});
}
function a_({ stage: e, preview: t, origin: n, onClose: r, onSendReviewed: i, disabled: a = !1 }) {
	let o = j(), s = $g[t.purpose], c = /* @__PURE__ */ (0, A.jsx)(wr, {
		variant: "quiet",
		onClick: r,
		children: o("ASK.consent.cancel")
	});
	if (s !== e) return /* @__PURE__ */ (0, A.jsx)(Cp, {
		kind: o("ASK.consent.kind"),
		title: o("ASK.consent.mismatch.title"),
		onClose: r,
		origin: n,
		actions: c,
		children: /* @__PURE__ */ (0, A.jsx)("p", {
			className: G.note,
			children: o("ASK.consent.mismatch")
		})
	});
	let l = {
		label: o(`ASK.consent.${s}.send`),
		onPress: () => i({
			previewId: t.id,
			digest: t.digest,
			consent: !0
		}),
		money: !0,
		disabled: a
	};
	return /* @__PURE__ */ (0, A.jsxs)(Cp, {
		kind: o("ASK.consent.kind"),
		title: o(`ASK.consent.${s}.title`),
		onClose: r,
		origin: n,
		primary: l,
		actions: c,
		children: [
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: G.note,
				children: o(`ASK.consent.${s}.note`)
			}),
			/* @__PURE__ */ (0, A.jsx)(e_, {
				title: o("ASK.consent.question"),
				children: /* @__PURE__ */ (0, A.jsx)("p", {
					className: G.exact,
					children: t.naturalQuestion
				})
			}),
			t.purpose === "conversation" ? /* @__PURE__ */ (0, A.jsx)(r_, { preview: t }) : /* @__PURE__ */ (0, A.jsx)(i_, { preview: t }),
			/* @__PURE__ */ (0, A.jsx)(e_, {
				title: o("ASK.consent.details"),
				children: /* @__PURE__ */ (0, A.jsxs)("dl", {
					className: G.pairs,
					children: [
						/* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.route"),
							mono: !0,
							children: t.routeId
						}),
						/* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.endpoint"),
							mono: t.endpoint !== void 0,
							children: t.endpoint === void 0 ? o("ASK.consent.endpoint.unknown") : t.endpoint
						}),
						/* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.level"),
							children: o(`ASK.consent.level.${t.send}`)
						}),
						/* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.boundary"),
							children: o(`ASK.consent.boundary.${t.receiptBoundary}`)
						}),
						/* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.observed"),
							children: o(t.providerPayloadObserved ? "ASK.consent.observed.yes" : "ASK.consent.observed.no")
						}),
						/* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.preview"),
							mono: !0,
							children: t.id
						}),
						/* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.digest"),
							mono: !0,
							children: t.digest
						}),
						t.purpose === "conversation" && t.continuationId !== void 0 && /* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.continuation.id"),
							mono: !0,
							children: t.continuationId
						}),
						t.purpose === "conversation" && t.continuationDigest !== void 0 && /* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.continuation.digest"),
							mono: !0,
							children: t.continuationDigest
						}),
						t.purpose === "conversation-synthesis" && /* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.synthesis.turn"),
							mono: !0,
							children: t.toolTurnId
						}),
						t.purpose === "conversation-synthesis" && /* @__PURE__ */ (0, A.jsx)(t_, {
							name: o("ASK.consent.synthesis.digest"),
							mono: !0,
							children: t.synthesisInputDigest
						})
					]
				})
			}),
			/* @__PURE__ */ (0, A.jsx)(e_, {
				title: o("ASK.consent.payload"),
				children: /* @__PURE__ */ (0, A.jsx)("pre", {
					className: [G.payload, "fig"].join(" "),
					children: t.payload
				})
			})
		]
	});
}
var K = {
	answer: "_answer_7xx6j_4",
	question: "_question_7xx6j_13",
	section: "_section_7xx6j_30",
	group: "_group_7xx6j_31",
	label: "_label_7xx6j_37",
	text: "_text_7xx6j_45",
	note: "_note_7xx6j_51",
	missing: "_missing_7xx6j_57",
	code: "_code_7xx6j_62",
	paragraph: "_paragraph_7xx6j_69",
	tool: "_tool_7xx6j_75",
	rows: "_rows_7xx6j_81",
	row: "_row_7xx6j_81",
	result: "_result_7xx6j_89",
	tags: "_tags_7xx6j_103",
	tag: "_tag_7xx6j_103",
	pairs: "_pairs_7xx6j_126",
	refs: "_refs_7xx6j_127",
	figures: "_figures_7xx6j_128",
	pair: "_pair_7xx6j_126",
	name: "_name_7xx6j_141",
	value: "_value_7xx6j_146",
	figure: "_figure_7xx6j_128",
	id: "_id_7xx6j_173",
	ids: "_ids_7xx6j_181",
	actions: "_actions_7xx6j_189",
	more: "_more_7xx6j_197",
	summary: "_summary_7xx6j_201",
	detail: "_detail_7xx6j_212"
}, o_ = {
	"business.describe": "ASK.answer.tool.business",
	"calculator.calculate": "ASK.answer.tool.calculation"
}, s_ = {
	"business.describe": "ASK.answer.savedAnswer.business",
	"calculator.calculate": "ASK.answer.savedAnswer.calculation"
};
function q({ name: e, mono: t = !1, children: n }) {
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: K.pair,
		children: [/* @__PURE__ */ (0, A.jsx)("dt", {
			className: K.name,
			children: e
		}), /* @__PURE__ */ (0, A.jsx)("dd", {
			className: [K.value, t ? "fig" : ""].filter(Boolean).join(" "),
			children: n
		})]
	});
}
function c_({ name: e, children: t }) {
	let n = (0, _.useId)();
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: K.group,
		children: [/* @__PURE__ */ (0, A.jsx)("p", {
			id: n,
			className: K.label,
			children: e
		}), /* @__PURE__ */ (0, A.jsx)("ul", {
			className: K.rows,
			"aria-labelledby": n,
			children: t
		})]
	});
}
function l_({ name: e, children: t }) {
	return /* @__PURE__ */ (0, A.jsxs)("details", {
		className: K.more,
		children: [/* @__PURE__ */ (0, A.jsx)("summary", {
			className: K.summary,
			children: e
		}), /* @__PURE__ */ (0, A.jsx)("div", {
			className: K.detail,
			children: t
		})]
	});
}
function u_({ name: e, children: t }) {
	let n = (0, _.useId)();
	return /* @__PURE__ */ (0, A.jsxs)("details", {
		className: K.more,
		children: [/* @__PURE__ */ (0, A.jsx)("summary", {
			id: n,
			className: K.summary,
			children: e
		}), /* @__PURE__ */ (0, A.jsx)("ul", {
			className: K.rows,
			"aria-labelledby": n,
			children: t
		})]
	});
}
function d_({ intent: e, onReference: t }) {
	return /* @__PURE__ */ (0, A.jsx)(wr, {
		variant: "link",
		className: K.id,
		onClick: () => t(e),
		children: e.id
	});
}
function f_({ kind: e, ids: t, onReference: n }) {
	return t.length === 0 ? /* @__PURE__ */ (0, A.jsx)(Lp, { missing: "none" }) : /* @__PURE__ */ (0, A.jsx)("span", {
		className: K.ids,
		children: t.map((t) => /* @__PURE__ */ (0, A.jsx)(d_, {
			intent: {
				kind: e,
				id: t
			},
			onReference: n
		}, t))
	});
}
function p_({ ids: e }) {
	return e.length === 0 ? /* @__PURE__ */ (0, A.jsx)(Lp, { missing: "none" }) : /* @__PURE__ */ (0, A.jsx)("span", {
		className: K.ids,
		children: e.map((e) => /* @__PURE__ */ (0, A.jsx)("span", {
			className: K.id,
			children: e
		}, e))
	});
}
function m_(e, t) {
	return t.unit === "money" ? t.currency === void 0 ? e("ASK.answer.figure.money", { exact: t.minor }) : e("ASK.answer.figure.money.currency", {
		exact: t.minor,
		currency: t.currency
	}) : t.currency === void 0 ? e("ASK.answer.figure.points", { exact: t.minor }) : e("ASK.answer.figure.points.currency", {
		exact: t.minor,
		currency: t.currency
	});
}
function h_(e) {
	return e.coverage.completeness === "empty" || e.coverage.completeness === "partial" && e.coverage.countedRows === 0;
}
function g_({ figure: e, receiptId: t, onReference: n }) {
	let r = j();
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: K.pair,
		children: [/* @__PURE__ */ (0, A.jsx)("dt", { children: e.label }), /* @__PURE__ */ (0, A.jsx)("dd", {
			className: K.value,
			children: /* @__PURE__ */ (0, A.jsx)(wr, {
				variant: "link",
				className: K.figure,
				title: r("FIGURE.title", {
					exact: e.minor,
					receipt: t
				}),
				"aria-label": r("ASK.answer.figure.open", {
					label: e.label,
					display: e.display,
					exact: m_(r, e),
					receipt: t
				}),
				onClick: () => n({
					kind: "calculation-receipt",
					id: t
				}),
				children: e.display
			})
		})]
	});
}
function __({ receipt: e, message: t, onReference: n }) {
	let r = j(), i = e.period, a = e.comparePeriod, o = h_(e), s = /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [t !== void 0 && /* @__PURE__ */ (0, A.jsx)("p", {
		className: K.text,
		children: t
	}), e.explanation !== "" && e.explanation !== t && /* @__PURE__ */ (0, A.jsx)("p", {
		className: K.text,
		children: e.explanation
	})] });
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: K.group,
		children: [
			!o && s,
			e.stale && /* @__PURE__ */ (0, A.jsxs)("p", {
				className: K.note,
				children: [
					/* @__PURE__ */ (0, A.jsx)(Mp, { kind: "stale" }),
					" ",
					r("ST.stale.plain")
				]
			}),
			e.staleReason !== void 0 && /* @__PURE__ */ (0, A.jsx)("p", {
				className: K.note,
				children: e.staleReason
			}),
			o ? /* @__PURE__ */ (0, A.jsx)("dl", {
				className: K.figures,
				children: /* @__PURE__ */ (0, A.jsxs)("div", {
					className: K.pair,
					children: [/* @__PURE__ */ (0, A.jsx)("dt", { children: r("ASK.answer.calculation.figure") }), /* @__PURE__ */ (0, A.jsx)("dd", {
						className: K.value,
						children: /* @__PURE__ */ (0, A.jsx)(Lp, { missing: "unknown" })
					})]
				})
			}) : e.figures.length > 0 ? /* @__PURE__ */ (0, A.jsx)("dl", {
				className: K.figures,
				children: e.figures.map((t) => /* @__PURE__ */ (0, A.jsx)(g_, {
					figure: t,
					receiptId: e.id,
					onReference: n
				}, t.key))
			}) : /* @__PURE__ */ (0, A.jsx)("p", {
				className: K.missing,
				children: r("ASK.answer.calculation.noFigures")
			}),
			/* @__PURE__ */ (0, A.jsx)("dl", {
				className: K.pairs,
				children: /* @__PURE__ */ (0, A.jsx)(q, {
					name: r("ASK.answer.coverage.completeness"),
					children: r(`ASK.answer.coverage.completeness.${e.coverage.completeness}`)
				})
			}),
			e.coverage.gaps.length > 0 && /* @__PURE__ */ (0, A.jsx)(c_, {
				name: r("ASK.answer.coverage.gaps"),
				children: e.coverage.gaps.map((e, t) => /* @__PURE__ */ (0, A.jsx)("li", {
					className: K.row,
					children: /* @__PURE__ */ (0, A.jsx)("p", {
						className: K.text,
						children: e
					})
				}, t))
			}),
			/* @__PURE__ */ (0, A.jsxs)(l_, {
				name: r("ASK.answer.detail.calculation"),
				children: [o && s, /* @__PURE__ */ (0, A.jsxs)("dl", {
					className: K.pairs,
					children: [
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.calculation.operation"),
							mono: !0,
							children: e.operation
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.calculation.period"),
							children: i === null ? r("ASK.answer.notSpecified") : r("ASK.answer.period", {
								from: i.from,
								to: i.to
							})
						}),
						a !== null && /* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.calculation.comparePeriod"),
							children: r("ASK.answer.period", {
								from: a.from,
								to: a.to
							})
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.scope.branch"),
							children: e.branch ?? r("ASK.answer.notSpecified")
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.scope.asOf"),
							mono: !0,
							children: e.asOf
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.calculation.currency"),
							mono: !0,
							children: e.currency
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.sources"),
							children: /* @__PURE__ */ (0, A.jsx)(p_, { ids: e.sourceIds })
						}),
						e.requestedSourceIds !== void 0 && /* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.calculation.requestedSources"),
							children: /* @__PURE__ */ (0, A.jsx)(p_, { ids: e.requestedSourceIds })
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.coverage.selected"),
							mono: !0,
							children: e.coverage.selectedRows
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.coverage.counted"),
							mono: !0,
							children: e.coverage.countedRows
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.coverage.excluded"),
							mono: !0,
							children: e.coverage.excludedRows
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.coverage.conflicts"),
							mono: !0,
							children: e.coverage.unresolvedConflicts
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: r("ASK.answer.calculationReceipt"),
							children: /* @__PURE__ */ (0, A.jsx)(d_, {
								intent: {
									kind: "calculation-receipt",
									id: e.id
								},
								onReference: n
							})
						})
					]
				})]
			})
		]
	});
}
function v_({ answer: e, onReference: t }) {
	return "supported" in e ? /* @__PURE__ */ (0, A.jsx)(__, {
		receipt: e.receipt,
		message: e.message,
		onReference: t
	}) : /* @__PURE__ */ (0, A.jsx)(__, {
		receipt: e,
		onReference: t
	});
}
function y_({ answer: e, onReference: t }) {
	let n = j(), r = e.claims.length === 0 && e.unknowns.length === 0 && e.conflicts.length === 0;
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: K.group,
		children: [
			/* @__PURE__ */ (0, A.jsxs)("dl", {
				className: K.pairs,
				children: [
					/* @__PURE__ */ (0, A.jsx)(q, {
						name: n("ASK.answer.status"),
						children: n(`ASK.answer.business.status.${e.status}`)
					}),
					/* @__PURE__ */ (0, A.jsx)(q, {
						name: n("ASK.answer.scope.completeness"),
						children: n(`ASK.answer.scope.completeness.${e.scope.completeness}`)
					}),
					/* @__PURE__ */ (0, A.jsx)(q, {
						name: n("ASK.answer.scope.synthetic"),
						children: n(e.scope.syntheticFixture ? "CHOICE.yes" : "CHOICE.no")
					})
				]
			}),
			r && e.message !== "" && /* @__PURE__ */ (0, A.jsx)("p", {
				className: K.text,
				children: e.message
			}),
			e.claims.length > 0 && /* @__PURE__ */ (0, A.jsx)(u_, {
				name: n("ASK.answer.business.claims"),
				children: e.claims.map((e) => /* @__PURE__ */ (0, A.jsxs)("li", {
					className: K.row,
					children: [
						/* @__PURE__ */ (0, A.jsx)("p", {
							className: K.text,
							children: e.text
						}),
						/* @__PURE__ */ (0, A.jsxs)("p", {
							className: K.tags,
							children: [
								/* @__PURE__ */ (0, A.jsx)("span", {
									className: K.tag,
									children: n(`ASK.answer.category.${e.category}`)
								}),
								/* @__PURE__ */ (0, A.jsx)("span", {
									className: K.tag,
									children: n(`ASK.answer.origin.${e.origin}`)
								}),
								/* @__PURE__ */ (0, A.jsx)("span", {
									className: K.tag,
									children: n(`ASK.answer.qualification.${e.qualification}`)
								})
							]
						}),
						/* @__PURE__ */ (0, A.jsx)("dl", {
							className: K.refs,
							children: /* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.refs.citations"),
								children: /* @__PURE__ */ (0, A.jsx)(f_, {
									kind: "citation",
									ids: e.citationIds,
									onReference: t
								})
							})
						})
					]
				}, e.id))
			}),
			e.unknowns.length > 0 && /* @__PURE__ */ (0, A.jsx)(u_, {
				name: n("ASK.answer.business.unknowns"),
				children: e.unknowns.map((e) => /* @__PURE__ */ (0, A.jsxs)("li", {
					className: K.row,
					children: [/* @__PURE__ */ (0, A.jsx)("p", {
						className: K.text,
						children: e.message
					}), /* @__PURE__ */ (0, A.jsx)("p", {
						className: K.tags,
						children: /* @__PURE__ */ (0, A.jsx)("span", {
							className: K.tag,
							children: n(`ASK.answer.category.${e.category}`)
						})
					})]
				}, e.category))
			}),
			e.conflicts.length > 0 && /* @__PURE__ */ (0, A.jsx)(u_, {
				name: n("ASK.answer.business.conflicts"),
				children: e.conflicts.map((e, r) => /* @__PURE__ */ (0, A.jsxs)("li", {
					className: K.row,
					children: [
						/* @__PURE__ */ (0, A.jsx)("p", {
							className: K.text,
							children: e.reason
						}),
						/* @__PURE__ */ (0, A.jsx)("p", {
							className: K.tags,
							children: /* @__PURE__ */ (0, A.jsx)("span", {
								className: K.tag,
								children: n(`ASK.answer.category.${e.category}`)
							})
						}),
						/* @__PURE__ */ (0, A.jsx)("dl", {
							className: K.refs,
							children: /* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.refs.citations"),
								children: /* @__PURE__ */ (0, A.jsx)(f_, {
									kind: "citation",
									ids: e.citationIds,
									onReference: t
								})
							})
						})
					]
				}, r))
			}),
			e.scope.limitations.length > 0 && /* @__PURE__ */ (0, A.jsx)(u_, {
				name: n("ASK.answer.business.limitations"),
				children: e.scope.limitations.map((e, t) => /* @__PURE__ */ (0, A.jsx)("li", {
					className: K.row,
					children: /* @__PURE__ */ (0, A.jsx)("p", {
						className: K.text,
						children: e
					})
				}, t))
			}),
			e.citations.length > 0 && /* @__PURE__ */ (0, A.jsx)(u_, {
				name: n("ASK.answer.business.citations"),
				children: e.citations.map((e) => /* @__PURE__ */ (0, A.jsx)("li", {
					className: K.row,
					children: /* @__PURE__ */ (0, A.jsxs)("dl", {
						className: K.refs,
						children: [
							/* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.citation"),
								children: /* @__PURE__ */ (0, A.jsx)(d_, {
									intent: {
										kind: "citation",
										id: e.id
									},
									onReference: t
								})
							}),
							/* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.citation.kind"),
								children: n(`ASK.answer.citation.kind.${e.kind}`)
							}),
							/* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.citation.path"),
								mono: !0,
								children: e.path
							}),
							e.sourceId !== void 0 && /* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.citation.source"),
								mono: !0,
								children: e.sourceId
							}),
							e.sourceRow !== void 0 && /* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.citation.row"),
								mono: !0,
								children: e.sourceRow
							}),
							e.branch !== void 0 && /* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.scope.branch"),
								children: e.branch
							}),
							e.validFrom !== void 0 && /* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.citation.validFrom"),
								mono: !0,
								children: e.validFrom
							}),
							e.validTo !== void 0 && /* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.citation.validTo"),
								mono: e.validTo !== null,
								children: e.validTo ?? n("ASK.answer.notSpecified")
							}),
							e.learnedAt !== void 0 && /* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.citation.learnedAt"),
								mono: !0,
								children: e.learnedAt
							})
						]
					})
				}, e.id))
			}),
			/* @__PURE__ */ (0, A.jsx)(l_, {
				name: n("ASK.answer.detail.business"),
				children: /* @__PURE__ */ (0, A.jsxs)("dl", {
					className: K.pairs,
					children: [
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: n("ASK.answer.scope.corpus"),
							children: n(`ASK.answer.scope.corpus.${e.scope.corpus}`)
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: n("ASK.answer.scope.branch"),
							children: e.scope.branch ?? n("ASK.answer.notSpecified")
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: n("ASK.answer.scope.asOf"),
							mono: !0,
							children: e.scope.asOf
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: n("ASK.answer.scope.onDate"),
							mono: !0,
							children: e.scope.onDate
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: n("ASK.answer.sources"),
							children: /* @__PURE__ */ (0, A.jsx)(p_, { ids: e.sourceIds })
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: n("ASK.answer.contextDigest"),
							mono: !0,
							children: e.contextDigest
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: n("ASK.answer.businessReceipt"),
							children: /* @__PURE__ */ (0, A.jsx)(d_, {
								intent: {
									kind: "business-context-receipt",
									id: e.receipt.id
								},
								onReference: t
							})
						}),
						e.receipt.modelReceiptId !== void 0 && /* @__PURE__ */ (0, A.jsx)(q, {
							name: n("ASK.answer.modelReceipt"),
							children: /* @__PURE__ */ (0, A.jsx)(d_, {
								intent: {
									kind: "model-receipt",
									id: e.receipt.modelReceiptId
								},
								onReference: t
							})
						})
					]
				})
			})
		]
	});
}
function b_({ result: e, onReference: t }) {
	let n = j(), r = /* @__PURE__ */ (0, A.jsx)("h3", {
		className: K.tool,
		children: n(o_[e.tool])
	});
	return e.error === void 0 ? e.tool === "business.describe" ? /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [r, /* @__PURE__ */ (0, A.jsx)(y_, {
		answer: e.answer,
		onReference: t
	})] }) : /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [r, /* @__PURE__ */ (0, A.jsx)(__, {
		receipt: e.answer,
		onReference: t
	})] }) : /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [
		r,
		/* @__PURE__ */ (0, A.jsx)("p", {
			className: K.note,
			children: n("ASK.answer.tool.error")
		}),
		/* @__PURE__ */ (0, A.jsx)("p", {
			className: K.text,
			children: e.error.message
		}),
		/* @__PURE__ */ (0, A.jsx)("p", {
			className: [K.code, "fig"].join(" "),
			children: n("ST.failed.code", { code: e.error.code })
		})
	] });
}
function x_({ tools: e, onReference: t }) {
	let n = j(), r = (0, _.useId)();
	return /* @__PURE__ */ (0, A.jsxs)("section", {
		className: K.section,
		"aria-labelledby": r,
		children: [
			/* @__PURE__ */ (0, A.jsx)("h2", {
				id: r,
				className: K.label,
				children: n("ASK.answer.tools")
			}),
			/* @__PURE__ */ (0, A.jsx)("ol", {
				className: K.rows,
				children: e.results.map((e, n) => /* @__PURE__ */ (0, A.jsx)("li", {
					className: K.result,
					children: /* @__PURE__ */ (0, A.jsx)(b_, {
						result: e,
						onReference: t
					})
				}, n))
			}),
			/* @__PURE__ */ (0, A.jsx)(l_, {
				name: n("ASK.answer.detail.turn"),
				children: /* @__PURE__ */ (0, A.jsxs)("dl", {
					className: K.pairs,
					children: [
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: n("ASK.answer.toolReceipt"),
							children: /* @__PURE__ */ (0, A.jsx)(d_, {
								intent: {
									kind: "conversation-tool-receipt",
									id: e.receipt.id
								},
								onReference: t
							})
						}),
						/* @__PURE__ */ (0, A.jsx)(q, {
							name: n("ASK.answer.modelReceipt"),
							children: /* @__PURE__ */ (0, A.jsx)(d_, {
								intent: {
									kind: "model-receipt",
									id: e.modelReceiptId
								},
								onReference: t
							})
						}),
						e.receipt.resultRefs.map((e) => /* @__PURE__ */ (0, A.jsx)(q, {
							name: n(s_[e.tool]),
							children: /* @__PURE__ */ (0, A.jsx)(d_, {
								intent: {
									kind: "answer",
									id: e.answerId
								},
								onReference: t
							})
						}, e.answerId))
					]
				})
			})
		]
	});
}
function S_({ reference: e, onReference: t }) {
	let n = j();
	return /* @__PURE__ */ (0, A.jsxs)("dl", {
		className: K.refs,
		children: [
			/* @__PURE__ */ (0, A.jsx)(q, {
				name: n("ASK.answer.refs.evidence"),
				children: /* @__PURE__ */ (0, A.jsx)(f_, {
					kind: "evidence",
					ids: e.evidenceRefs,
					onReference: t
				})
			}),
			/* @__PURE__ */ (0, A.jsx)(q, {
				name: n("ASK.answer.refs.answers"),
				children: /* @__PURE__ */ (0, A.jsx)(f_, {
					kind: "answer",
					ids: e.answerIds,
					onReference: t
				})
			}),
			/* @__PURE__ */ (0, A.jsx)(q, {
				name: n("ASK.answer.refs.receipts"),
				children: /* @__PURE__ */ (0, A.jsx)(f_, {
					kind: "receipt",
					ids: e.receiptIds,
					onReference: t
				})
			}),
			/* @__PURE__ */ (0, A.jsx)(q, {
				name: n("ASK.answer.refs.citations"),
				children: /* @__PURE__ */ (0, A.jsx)(f_, {
					kind: "citation",
					ids: e.citationIds,
					onReference: t
				})
			})
		]
	});
}
function C_({ answer: e, onReference: t }) {
	let n = j(), r = (0, _.useId)(), i = e.receipt;
	return /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [
		/* @__PURE__ */ (0, A.jsxs)("section", {
			className: K.section,
			"aria-labelledby": r,
			children: [
				/* @__PURE__ */ (0, A.jsx)("h2", {
					id: r,
					className: K.label,
					children: n("ASK.answer.written")
				}),
				e.paragraphs.map((n, r) => {
					let i = e.references[r];
					return /* @__PURE__ */ (0, A.jsxs)("div", {
						className: K.paragraph,
						children: [/* @__PURE__ */ (0, A.jsx)("p", {
							className: K.text,
							children: n
						}), i !== void 0 && /* @__PURE__ */ (0, A.jsx)(S_, {
							reference: i,
							onReference: t
						})]
					}, r);
				}),
				e.cautions.length > 0 && /* @__PURE__ */ (0, A.jsx)(c_, {
					name: n("ASK.answer.cautions"),
					children: e.cautions.map((e) => /* @__PURE__ */ (0, A.jsxs)("li", {
						className: K.row,
						children: [/* @__PURE__ */ (0, A.jsx)("p", {
							className: K.text,
							children: e.text
						}), /* @__PURE__ */ (0, A.jsx)("dl", {
							className: K.refs,
							children: /* @__PURE__ */ (0, A.jsx)(q, {
								name: n("ASK.answer.refs.evidence"),
								children: /* @__PURE__ */ (0, A.jsx)(d_, {
									intent: {
										kind: "evidence",
										id: e.ref
									},
									onReference: t
								})
							})
						})]
					}, e.ref))
				})
			]
		}),
		/* @__PURE__ */ (0, A.jsx)(x_, {
			tools: e.tools,
			onReference: t
		}),
		/* @__PURE__ */ (0, A.jsx)(l_, {
			name: n("ASK.answer.synthesisReceipt"),
			children: /* @__PURE__ */ (0, A.jsxs)("dl", {
				className: K.pairs,
				children: [
					/* @__PURE__ */ (0, A.jsx)(q, {
						name: n("ASK.answer.synthesisReceipt.id"),
						children: /* @__PURE__ */ (0, A.jsx)(wr, {
							variant: "link",
							className: K.id,
							onClick: () => t({
								kind: "synthesis-receipt",
								receipt: i
							}),
							children: i.id
						})
					}),
					/* @__PURE__ */ (0, A.jsx)(q, {
						name: n("ASK.answer.synthesisReceipt.toolTurn"),
						children: /* @__PURE__ */ (0, A.jsx)("span", {
							className: K.id,
							children: i.toolTurnId
						})
					}),
					/* @__PURE__ */ (0, A.jsx)(q, {
						name: n("ASK.answer.synthesisReceipt.planner"),
						children: /* @__PURE__ */ (0, A.jsx)(d_, {
							intent: {
								kind: "model-receipt",
								id: i.plannerModelReceiptId
							},
							onReference: t
						})
					}),
					/* @__PURE__ */ (0, A.jsx)(q, {
						name: n("ASK.answer.synthesisReceipt.writer"),
						children: /* @__PURE__ */ (0, A.jsx)(d_, {
							intent: {
								kind: "model-receipt",
								id: i.synthesisModelReceiptId
							},
							onReference: t
						})
					}),
					/* @__PURE__ */ (0, A.jsx)(q, {
						name: n("ASK.answer.synthesisReceipt.input"),
						children: /* @__PURE__ */ (0, A.jsx)("span", {
							className: K.id,
							children: i.inputDigest
						})
					}),
					/* @__PURE__ */ (0, A.jsx)(q, {
						name: n("ASK.answer.synthesisReceipt.output"),
						children: /* @__PURE__ */ (0, A.jsx)("span", {
							className: K.id,
							children: i.outputDigest
						})
					})
				]
			})
		})
	] });
}
function w_({ answer: e, onAnswer: t, onReference: n }) {
	let r = j(), i = (0, _.useId)(), a = t;
	return /* @__PURE__ */ (0, A.jsxs)("section", {
		className: K.section,
		"aria-labelledby": i,
		children: [
			/* @__PURE__ */ (0, A.jsx)("h2", {
				id: i,
				className: K.label,
				children: r("ASK.answer.clarification")
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: K.text,
				children: e.clarification
			}),
			a !== void 0 && /* @__PURE__ */ (0, A.jsx)("div", {
				className: K.actions,
				children: /* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "quiet",
					onClick: () => a(),
					children: r("ASK.answer.continue")
				})
			}),
			/* @__PURE__ */ (0, A.jsx)("dl", {
				className: K.pairs,
				children: /* @__PURE__ */ (0, A.jsx)(q, {
					name: r("ASK.answer.modelReceipt"),
					children: /* @__PURE__ */ (0, A.jsx)(d_, {
						intent: {
							kind: "model-receipt",
							id: e.modelReceiptId
						},
						onReference: n
					})
				})
			})
		]
	});
}
function T_({ tool: e, children: t }) {
	let n = j(), r = (0, _.useId)();
	return /* @__PURE__ */ (0, A.jsxs)("section", {
		className: K.section,
		"aria-labelledby": r,
		children: [/* @__PURE__ */ (0, A.jsx)("h2", {
			id: r,
			className: K.label,
			children: n(o_[e])
		}), t]
	});
}
function E_({ saved: e, onPreviewFinalWriting: t, onContinue: n, onReference: r }) {
	let i = j(), a = (0, _.useId)(), o = n, s = t;
	return /* @__PURE__ */ (0, A.jsxs)("article", {
		className: K.answer,
		"aria-labelledby": a,
		children: [
			/* @__PURE__ */ (0, A.jsx)("h1", {
				id: a,
				className: K.question,
				children: e.question
			}),
			(() => {
				switch (e.kind) {
					case "clarification": return /* @__PURE__ */ (0, A.jsx)(w_, {
						answer: e.answer,
						onAnswer: o === void 0 ? void 0 : () => o(e.id),
						onReference: r
					});
					case "grounded-conversation": return /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)(x_, {
						tools: e.answer,
						onReference: r
					}), s !== void 0 && /* @__PURE__ */ (0, A.jsxs)("div", {
						className: K.actions,
						children: [/* @__PURE__ */ (0, A.jsx)(wr, {
							variant: "quiet",
							onClick: () => s(),
							children: i("ASK.answer.previewWriting")
						}), /* @__PURE__ */ (0, A.jsx)("span", {
							className: K.note,
							children: i("ASK.answer.previewWriting.note")
						})]
					})] });
					case "synthesized-conversation": return /* @__PURE__ */ (0, A.jsx)(C_, {
						answer: e.answer,
						onReference: r
					});
					case "business-context": return /* @__PURE__ */ (0, A.jsx)(T_, {
						tool: "business.describe",
						children: /* @__PURE__ */ (0, A.jsx)(y_, {
							answer: e.answer,
							onReference: r
						})
					});
					case "calculation": return /* @__PURE__ */ (0, A.jsx)(T_, {
						tool: "calculator.calculate",
						children: /* @__PURE__ */ (0, A.jsx)(v_, {
							answer: e.answer,
							onReference: r
						})
					});
				}
			})(),
			/* @__PURE__ */ (0, A.jsx)(l_, {
				name: i("ASK.answer.detail.saved"),
				children: /* @__PURE__ */ (0, A.jsxs)("dl", {
					className: K.pairs,
					children: [/* @__PURE__ */ (0, A.jsx)(q, {
						name: i("ASK.answer.saved.id"),
						children: /* @__PURE__ */ (0, A.jsx)("span", {
							className: K.id,
							children: e.id
						})
					}), /* @__PURE__ */ (0, A.jsx)(q, {
						name: i("ASK.answer.saved.at"),
						mono: !0,
						children: /* @__PURE__ */ (0, A.jsx)("time", {
							dateTime: e.at,
							children: e.at
						})
					})]
				})
			})
		]
	});
}
//#endregion
//#region app/ui/src/app/ConversationWorkspace.tsx
function D_({ state: e, savedPlace: t, onContinue: n, onPreviewFinalWriting: r, onReference: i }) {
	let a = j(), o;
	switch (e.kind) {
		case "answer":
			o = /* @__PURE__ */ (0, A.jsx)(E_, {
				saved: e.saved,
				onContinue: n,
				onPreviewFinalWriting: r,
				onReference: i
			});
			break;
		case "continuation":
			o = /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)("p", { children: e.value.clarification }), /* @__PURE__ */ (0, A.jsx)("p", { children: a("ASK.workspace.continuation") })] });
			break;
		case "busy":
			o = /* @__PURE__ */ (0, A.jsx)("p", {
				role: "status",
				children: a("ASK.workspace.busy")
			});
			break;
		case "review":
			o = /* @__PURE__ */ (0, A.jsx)("p", { children: a("ASK.workspace.review") });
			break;
		case "unavailable":
			o = /* @__PURE__ */ (0, A.jsx)("p", {
				role: "status",
				children: a("ASK.workspace.unavailable", { code: e.code })
			});
			break;
		case "idle": o = /* @__PURE__ */ (0, A.jsx)("p", { children: a("ASK.workspace.empty") });
	}
	return /* @__PURE__ */ (0, A.jsxs)("section", {
		"aria-label": a("SH-01.place.ask"),
		children: [e.kind !== "answer" && /* @__PURE__ */ (0, A.jsx)(Up, {
			where: a("SH-01.place.ask"),
			title: a(t ? "SH-01.sub.ask.saved" : "SH-01.sub.ask.new")
		}), o]
	});
}
function O_({ app: e, conversation: t, questionSettings: n, contextKey: r, readback: i, onReference: a }) {
	let o = (0, _.useSyncExternalStore)(t.subscribe, t.snapshot, t.snapshot), [s, c] = (0, _.useState)(null), l = (0, _.useRef)(null), u = (0, _.useRef)(null), d = (0, _.useRef)(null), f = (0, _.useRef)(r), p = (0, _.useRef)(n), m = (0, _.useRef)(t), h = (0, _.useRef)(null), g = {
		kind: e.shellKind,
		view: e.view,
		administers: e.administers,
		allowed: e.allowed
	}, v = e.lock != null || fr(e.today.data.state), y = f.current === r && p.current === n && m.current === t, b = y ? Yg(g, s, v) : null;
	(0, _.useLayoutEffect)(() => {
		(f.current !== r || p.current !== n || m.current !== t) && (f.current = r, p.current = n, m.current = t, h.current = null, u.current = null, t.invalidate());
	}, [
		r,
		n,
		t
	]), (0, _.useLayoutEffect)(() => () => {
		u.current = null, h.current = null, t.invalidate();
	}, [t]), (0, _.useLayoutEffect)(() => {
		u.current !== null && Yg(g, u.current, v) === null && (u.current = null, h.current = null, t.invalidate(v ? "VAULT_LOCKED" : "ACCESS_DENIED"));
	}, [
		t,
		v,
		e.allowed,
		e.administers,
		e.shellKind,
		e.view
	]);
	let x = (e) => {
		window.location.hash = Un(e);
	}, S = (e) => {
		u.current = e, x(e);
	}, C = () => {
		d.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	}, w = (0, _.useCallback)((n) => {
		l.current = n, c((e) => e === null && n === null || e !== null && n !== null && Wn(e, n) ? e : n), u.current !== null && !qg(u.current, n) && (u.current = null, h.current = null, t.invalidate()), e.onAddress?.(n);
	}, [t, e.onAddress]), T = (e) => {
		let r = Jg(g, v);
		if (r === null || !y) {
			u.current = null, t.invalidate("ACCESS_DENIED");
			return;
		}
		try {
			let i = Xg(n, e);
			if (i === null) return;
			C(), S(Gg(r)), t.preview(i);
		} catch {
			S(Kg(r)), t.invalidate("INVALID_REPLY");
		}
	}, ee = (n) => {
		let r = u.current;
		r !== null && S(Kg(r)), t.editQuestion(), e.ask.onChange?.(n);
	}, E = () => {
		let e = u.current;
		e !== null && S(Kg(e)), t.cancel();
	}, te = (e) => {
		if (b === null || !qg(u.current, b)) {
			u.current = null, t.invalidate("ACCESS_DENIED");
			return;
		}
		S(Kg(b)), t.sendReviewed(e);
	}, D = (e) => {
		let n = Yg(g, l.current, v);
		n !== null && qg(u.current, n) && (S(Kg(n)), t.selectContinuation(e));
	}, O = () => {
		let e = Yg(g, l.current, v);
		e !== null && qg(u.current, e) && (C(), S(Gg(e)), t.previewFinalWriting());
	}, ne = i === void 0 ? null : Un(i.address), re = i === void 0 ? null : JSON.stringify([
		i.id,
		i.selectionKey,
		ne
	]), ie = s === null ? null : Un(s);
	(0, _.useLayoutEffect)(() => {
		if (i === void 0) {
			l.current?.place === "ask" && l.current.sub === "saved" && u.current !== null && (u.current = null, h.current = null, t.invalidate());
			return;
		}
		if (h.current !== null && h.current !== re && (u.current = null, h.current = null, t.invalidate()), h.current === re || ne !== ie || !y) return;
		let e = Yg(g, l.current, v);
		e !== null && e.sub === "saved" && (h.current = re, u.current = e, t.open(i.id));
	}, [
		t,
		i?.id,
		i?.selectionKey,
		ne,
		ie,
		y,
		v,
		e.allowed,
		e.shellKind,
		e.view,
		e.administers
	]);
	let ae = b?.sub !== "saved" || i !== void 0 && h.current === re, oe = b !== null && ae && qg(u.current, b), se = oe && o.kind === "review" ? {
		address: b,
		content: /* @__PURE__ */ (0, A.jsx)(a_, {
			stage: o.stage,
			preview: o.preview,
			origin: d.current,
			onClose: E,
			onSendReviewed: te
		})
	} : e.sheet, ce = (t) => {
		if (Yg(g, t, v) === null) return e.renderPlace?.(t);
		let n = oe && qg(b, t) && h.current === re;
		if (t.sub === "saved" && (i === void 0 || !Wn(t, i.address) && !n)) return e.renderPlace?.(t);
		let r = oe && qg(b, t) ? o : { kind: "idle" };
		return /* @__PURE__ */ (0, A.jsx)(D_, {
			state: r,
			savedPlace: t.sub === "saved",
			onContinue: D,
			onPreviewFinalWriting: O,
			onReference: (e) => {
				r.kind === "answer" && a(e, r.saved);
			}
		});
	}, le = e.onHelp === void 0 ? void 0 : (n, r) => {
		if (v || !y) return;
		let i = o.kind === "review" || o.kind === "busy" ? d.current : n;
		u.current = null, h.current = null, t.cancel(), e.onHelp?.(i, r);
	};
	return /* @__PURE__ */ (0, A.jsx)(Qm, {
		...e,
		ask: {
			...e.ask,
			onAsk: T,
			onChange: ee
		},
		onAddress: w,
		renderPlace: ce,
		sheet: se,
		onHelp: le
	}, r);
}
//#endregion
//#region app/ui/src/bridge/client.ts
var k_ = /* @__PURE__ */ "INVALID_REPLY.READ_INVALIDATED.ACCESS_DENIED.VAULT_LOCKED.UNAUTHENTICATED.EVIDENCE_UNAVAILABLE.ACCESS_REVOKED.SOURCE_REVOKED.BRANCH_FORBIDDEN.RECEIPT_FORBIDDEN.FORBIDDEN.RECEIPT_NOT_FOUND.INVALID_SESSION.ROUTE_REVOKED.OUTBOUND_APPROVAL_REQUIRED.CONVERSATION_CONTINUATION_RESOLVED.CONVERSATION_CONTINUATION_LIMIT.PREVIEW_STALE.PAYLOAD_CHANGED.PREVIEW_REQUEST_CHANGED.SYNTHESIS_STALE.CONVERSATION_CONTINUATION_STALE.MODEL_RECEIPT_EXPIRED.CALCULATION_STALE.CONVERSATION_NOT_FOUND.CONVERSATION_CONTINUATION_UNAVAILABLE.MODEL_RECEIPT_NOT_FOUND.SYNTHESIS_UNAVAILABLE.SCENARIO_UNAVAILABLE.SCENARIO_REVISION_UNAVAILABLE.SCENARIO_EVIDENCE_UNAVAILABLE.SCENARIO_FORBIDDEN.SCENARIO_AUTHORITY_CHANGED.SCENARIO_ARTIFACT_CHANGED.SCENARIO_RETENTION_EXPIRED.SCENARIO_HOST_REQUIRED.SCENARIO_CUSTODY_INVALID.SCENARIO_CUSTODY_CONFLICT.SCENARIO_TAINTED_CONTEXT.SCENARIO_WORKSPACE_CHANGED.SCENARIO_RUN_UNAVAILABLE.SCENARIO_READ_ONLY.SCENARIO_HEAD_CHANGED.SCENARIO_JOB_UNAVAILABLE.SCENARIO_BRANCH_UNAVAILABLE.SCENARIO_GRAPH_INVALID.SCENARIO_VECTOR_MISMATCH.INVALID_SCENARIO.LESSON_AUTHORITY_REQUIRED.LESSON_AUTHORITY_REVISION_REQUIRED.LESSON_AUTHORITY_CHANGED.LESSON_REVIEW_CHANGED.LESSON_EVALUATION_BLOCKED.EVALUATION_AUTHORITY_REQUIRED.EVALUATION_CHANGED.EVALUATION_CANDIDATE_MISMATCH.EVALUATION_PROVENANCE_REQUIRED.EVALUATION_COMPARISON_MISMATCH.INVALID_LESSON_EVALUATION.LESSON_EVIDENCE_UNAVAILABLE.LESSON_EVIDENCE_CHANGED.LESSON_TARGET_CHANGED.LESSON_OWNER_REQUIRED.LESSON_WORKSPACE_CHANGED.LESSON_NOT_FOUND.LESSON_CHANGED.INVALID_LESSON.INVALID_LESSON_DECISION.INVALID_LESSON_STATE.INVALID_LESSON_TARGET.APP_LESSON_REVIEW_REQUIRED.TAINTED_LESSON.LESSON_CONFLICT.INVALID_SUPERSESSION.INVALID_REQUEST.REQUEST_TOO_LARGE.UNTRUSTED_SENDER.REQUEST_FAILED".split(".");
function A_(e, t) {
	if (typeof e != "object" || !e || Object.getPrototypeOf(e) !== Object.prototype) return null;
	let n = Reflect.ownKeys(e);
	if (n.length !== t.length || n.some((e) => typeof e != "string" || !t.includes(e))) return null;
	let r = Object.getOwnPropertyDescriptors(e);
	return t.some((e) => !r[e]?.enumerable || !Object.hasOwn(r[e], "value")) ? null : r;
}
function j_(e) {
	return Object.assign(/* @__PURE__ */ Error("The desktop request failed."), { code: e });
}
function M_(e) {
	let t = "REQUEST_FAILED";
	try {
		let n = A_(e, [
			"version",
			"ok",
			"result"
		]);
		if (n?.version?.value === 1 && n.ok?.value === !0) return n.result.value;
		let r = A_(e, [
			"version",
			"ok",
			"error"
		]);
		if (r?.version?.value === 1 && r.ok?.value === !1) {
			let e = A_(r.error.value, ["code"]), n = k_.find((t) => t === e?.code?.value);
			n && (t = n);
		}
	} catch {}
	throw j_(t);
}
function N_(e) {
	return Object.freeze({ async request(t, n = {}) {
		let r;
		try {
			r = await e.requestEnvelope(t, n);
		} catch {
			throw j_("REQUEST_FAILED");
		}
		return M_(r);
	} });
}
function P_(e) {
	if (typeof e != "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(e)) throw new $m("request.id");
}
var F_ = [
	"ACCESS_DENIED",
	"VAULT_LOCKED",
	"UNAUTHENTICATED",
	"EVIDENCE_UNAVAILABLE"
];
function I_(e) {
	return F_.includes(e);
}
function L_(e) {
	if (e instanceof $m) return "INVALID_REPLY";
	let t;
	try {
		t = e && typeof e == "object" ? Object.getOwnPropertyDescriptor(e, "code") : void 0;
	} catch {
		return "REQUEST_FAILED";
	}
	let n = t && Object.hasOwn(t, "value") ? t.value : void 0;
	return [
		"INVALID_REPLY",
		"READ_INVALIDATED",
		...F_
	].find((e) => e === n) || (n === "VAULT_LOCKED" ? "VAULT_LOCKED" : n === "UNAUTHENTICATED" || n === "authentication_required" ? "UNAUTHENTICATED" : typeof n == "string" && [
		"ACCESS_REVOKED",
		"SOURCE_REVOKED",
		"BRANCH_FORBIDDEN",
		"RECEIPT_FORBIDDEN",
		"FORBIDDEN",
		"authority_denied"
	].includes(n) ? "ACCESS_DENIED" : n === "RECEIPT_NOT_FOUND" || n === "not_found" || n === "model_artifact_unavailable" ? "EVIDENCE_UNAVAILABLE" : "REQUEST_FAILED");
}
async function R_(e, t, n, r) {
	try {
		let r = await e();
		if (!n()) return Object.freeze({
			ok: !1,
			code: "READ_INVALIDATED"
		});
		let i = await t(r);
		return n() ? Object.freeze({
			ok: !0,
			value: i
		}) : Object.freeze({
			ok: !1,
			code: "READ_INVALIDATED"
		});
	} catch (e) {
		if (!n()) return Object.freeze({
			ok: !1,
			code: "READ_INVALIDATED"
		});
		let t = L_(e);
		return I_(t) && r(), Object.freeze({
			ok: !1,
			code: t
		});
	}
}
function z_(e) {
	let t = Symbol();
	return Object.freeze({
		environment: "desktop",
		invalidate() {
			t = Symbol();
		},
		receipt(n) {
			let r = t;
			return R_(() => (P_(n), e.request("receipts.get", { id: n })), (e) => {
				let t = Mh(e);
				if (t.id !== n) throw new $m("receipt.id");
				return t;
			}, () => t === r, () => {
				t = Symbol();
			});
		}
	});
}
//#endregion
//#region app/ui/src/bridge/projections.ts
var B_ = class extends Error {
	code = "UNSUPPORTED_PRESENTATION_UNIT";
	constructor() {
		super("UNSUPPORTED_PRESENTATION_UNIT"), this.name = "UnsupportedPresentationUnitError";
	}
};
function V_(e, t, n = []) {
	let r = jh(e), i = r.figures.find((e) => e.key === t);
	if (!i) throw new $m("receipt.figures.key");
	if (n.some((e) => e !== "stale") || n.includes("stale") && !r.stale) throw new $m("receipt.labels");
	if (r.coverage.completeness === "empty" || r.coverage.completeness === "partial" && r.coverage.countedRows === 0) return kh({
		kind: "missing",
		state: "unknown"
	});
	let a = {
		receiptId: r.id,
		labels: r.stale ? ["stale"] : []
	};
	if (i.unit === "basis-points") return kh({
		kind: "percent",
		basisPoints: i.minor,
		...a
	});
	if (i.currency !== "INR" || r.currency !== "INR") throw new B_();
	return kh({
		kind: "money",
		currency: "INR",
		paise: i.minor,
		...a
	});
}
//#endregion
//#region app/ui/src/format/money.ts
function H_(e) {
	return sh(e), BigInt(e);
}
function U_(e) {
	if (!/^\d+$/.test(e)) throw TypeError("INVALID_FORMAT_VALUE");
	let t = BigInt(e).toString();
	return t.length <= 3 ? t : `${t.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${t.slice(-3)}`;
}
function W_(e) {
	let t = H_(e), n = t < 0n ? -t : t, r = n % 100n;
	return `${t < 0n ? "-" : ""}\u20b9${U_((n / 100n).toString())}${r === 0n ? "" : `.${r.toString().padStart(2, "0")}`}`;
}
function G_(e, t) {
	if (t.underHundred.length !== 100 || t.underHundred.some((e) => typeof e != "string" || e.length === 0)) throw TypeError("INVALID_FORMAT_WORDS");
	if (e < 100n) return t.underHundred[Number(e)];
	for (let [n, r] of [
		[10000000n, t.crore],
		[100000n, t.lakh],
		[1000n, t.thousand],
		[100n, t.hundred]
	]) if (e >= n) return `${G_(e / n, t)} ${r}${e % n ? ` ${G_(e % n, t)}` : ""}`;
	throw TypeError("INVALID_FORMAT_VALUE");
}
function K_(e, t) {
	let n = H_(e), r = n < 0n ? -n : n;
	return `${n < 0n ? `${t.minus} ` : ""}${G_(r / 100n, t)} ${t.rupees}${r % 100n ? ` ${t.and} ${G_(r % 100n, t)} ${t.paise}` : ""}`;
}
//#endregion
//#region app/ui/src/format/counts.ts
function q_(e) {
	return sh(e, "count", !1), U_(e);
}
function J_(e) {
	return `${Y_(e)}%`;
}
function Y_(e) {
	sh(e, "basisPoints");
	let t = BigInt(e), n = ((t < 0n ? -t : t) + 5n) / 10n;
	return `${t < 0n && n !== 0n ? "-" : ""}${U_((n / 10n).toString())}${n % 10n ? `.${n % 10n}` : ""}`;
}
//#endregion
//#region app/ui/src/format/dates.ts
function X_(e, t = "short", n = "en") {
	uh(e);
	let r = /* @__PURE__ */ new Date(`${e}T00:00:00.000Z`);
	if (t === "short" && n === "en") {
		let e = new Intl.DateTimeFormat("en-US", {
			day: "numeric",
			month: "short",
			year: "numeric",
			timeZone: "UTC"
		}).formatToParts(r), t = (t) => e.find((e) => e.type === t).value;
		return `${t("day")} ${t("month")} ${t("year")}`;
	}
	return new Intl.DateTimeFormat(n === "hi" ? "hi-IN" : "en-IN", t === "long" ? {
		weekday: "long",
		day: "numeric",
		month: "long",
		timeZone: "UTC"
	} : {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC"
	}).format(r);
}
function Z_(e, t) {
	return dh(e), new Intl.DateTimeFormat("en-IN", {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		timeZone: t
	}).format(new Date(e));
}
//#endregion
//#region app/ui/src/format/index.ts
function Q_(e, t) {
	if (kh({
		kind: "missing",
		state: e
	}), typeof t[e] != "string" || t[e].trim().length === 0) throw TypeError("MISSING_FORMAT_WORD");
	return t[e];
}
function $_(e, t) {
	let n = kh(e);
	switch (n.kind) {
		case "money": return W_(n.paise);
		case "count": return q_(n.count);
		case "percent": return J_(n.basisPoints);
		case "missing": return Q_(n.state, t);
	}
}
//#endregion
//#region app/ui/src/bridge/project-ui.ts
function ev(e) {
	return e && typeof e == "object" && (Object.values(e).forEach(ev), Object.freeze(e)), e;
}
function tv(e) {
	if (!["en", "hi"].includes(e.language) || typeof e.timeZone != "string" || !e.timeZone || e.maxStats !== void 0 && ![
		3,
		4,
		12
	].includes(e.maxStats)) throw new $m("format.context");
	try {
		new Intl.DateTimeFormat("en-IN", { timeZone: e.timeZone });
	} catch {
		throw new $m("format.timeZone");
	}
}
function nv(e, t) {
	if (e.kind === "missing") return {
		kind: "missing",
		missing: e.state
	};
	let n = $_(e, t.missingWords), r = e.kind === "money" ? e.paise : e.kind === "count" ? e.count : e.basisPoints, i = {
		kind: e.kind,
		exact: r,
		display: n,
		receiptId: e.receiptId,
		labels: [...e.labels]
	};
	return e.kind === "money" ? t.spokenMoneyWords ? {
		...i,
		spoken: K_(e.paise, t.spokenMoneyWords)
	} : i : {
		...i,
		spoken: n
	};
}
function rv(e, t) {
	return tv(t), e !== null && sh(e, "metadata.count", !1), ev({
		exact: e,
		display: e === null ? Q_("unknown", t.missingWords) : q_(e)
	});
}
function iv(e, t) {
	let n = {
		id: e.id,
		mark: e.mark,
		what: e.title,
		note: e.note,
		...e.figure ? { figure: nv(e.figure, t) } : {},
		...e.action ? { can: ["open"] } : {}
	};
	return e.action ? {
		row: n,
		action: e.action
	} : { row: n };
}
function av(e, t) {
	if (e === null) return {
		state: "missing",
		reasonCode: "CHART_NOT_PROVIDED"
	};
	if (![
		"columns",
		"line",
		"ordered-bar"
	].includes(e.kind)) return {
		state: "missing",
		reasonCode: "CHART_FORM_NOT_IMPLEMENTED"
	};
	if (e.points.length === 0) return {
		state: "missing",
		reasonCode: "CHART_HAS_NO_POINTS"
	};
	if (e.points.every((e) => e.value.kind === "missing")) return {
		state: "missing",
		reasonCode: "CHART_HAS_NO_KNOWN_POINTS"
	};
	let n = e.points.map((e) => ({
		id: e.id,
		label: e.label,
		value: nv(e.value, t)
	}));
	if (e.kind === "line") return {
		state: "available",
		chart: {
			form: "line",
			sentence: e.description,
			values: n,
			from: e.points[0].label,
			to: e.points.at(-1).label
		}
	};
	if (e.kind === "columns" || e.kind === "ordered-bar") return {
		state: "available",
		chart: {
			form: e.kind,
			sentence: e.description,
			values: n
		}
	};
	throw new $m("chart.kind");
}
function ov(e, t) {
	let n = av(e.chart, t);
	return {
		tile: {
			id: e.id,
			label: e.label,
			figure: nv(e.figure, t),
			chartState: n.state === "available" ? { state: "available" } : n,
			...e.change ? { change: nv(e.change, t) } : {},
			...e.changeLabel ? { changeLabel: e.changeLabel } : {},
			...n.state === "available" ? { chart: n.chart } : {}
		},
		chartState: n
	};
}
function sv(e, t) {
	tv(t);
	let n = Ah(e);
	if (n.stats.length > (t.maxStats ?? 3)) throw new $m("today.stats.layout-limit");
	let r = n.attention.map((e) => iv(e, t)), i = n.worthLook.map((e) => iv(e, t)), a = n.stats.map((e) => ov(e, t)), o = [...r, ...i].flatMap((e) => e.action ? [{
		rowId: e.row.id,
		intent: e.action
	}] : []);
	return ev({
		title: n.title,
		data: {
			state: n.state.kind === "ready" || n.state.kind === "empty" ? { kind: n.state.kind } : {
				kind: "boundary-state",
				source: n.state
			},
			date: X_(n.date, "long", t.language),
			review: {
				count: rv(n.pendingCount, t),
				rows: r.map((e) => e.row)
			},
			worthALook: i.map((e) => e.row),
			thisMonth: a.map((e) => e.tile),
			...a.length === 0 ? { thisMonthMissing: "unknown" } : {},
			earlierToday: n.dayEvents.map((e) => ({
				id: e.id,
				mark: e.mark,
				time: Z_(e.at, t.timeZone),
				words: e.label
			}))
		},
		rowActions: o,
		dayActions: n.dayEvents.flatMap((e) => e.action ? [{
			eventId: e.id,
			intent: e.action
		}] : []),
		chartStates: a.map((e) => ({
			statId: e.tile.id,
			state: e.chartState
		}))
	});
}
//#endregion
//#region app/ui/src/bridge/today-host.ts
var cv = [
	"billed",
	"received",
	"earned",
	"margin"
], lv = [
	"billed",
	"received",
	"net_sales",
	"margin",
	"aging"
], uv = {
	pendingCount: "TODAY_PENDING_COUNT_NOT_PROVIDED",
	attention: "TODAY_ATTENTION_CONTRACT_NOT_PROVIDED",
	worthLook: "TODAY_WORTH_LOOK_CONTRACT_NOT_PROVIDED",
	dayEvents: "TODAY_DAY_EVENTS_CONTRACT_NOT_PROVIDED",
	charts: "TODAY_CHART_SERIES_NOT_PROVIDED"
};
function J(e) {
	throw new $m(e);
}
function dv(e) {
	return e && typeof e == "object" && (Object.values(e).forEach(dv), Object.freeze(e)), e;
}
function fv(e, t, n = 0, r = {
	remaining: 2e5,
	characters: 8e6
}) {
	if ((n > 16 || --r.remaining < 0) && J(t), e === null || typeof e == "boolean") return;
	if (typeof e == "string") {
		r.characters -= e.length, (e.length > 2e6 || r.characters < 0) && J(t);
		return;
	}
	if (typeof e == "number") {
		Number.isFinite(e) || J(t);
		return;
	}
	(!e || typeof e != "object" || Object.getOwnPropertySymbols(e).length > 0) && J(t);
	let i = Object.getOwnPropertyDescriptors(e);
	if (Array.isArray(e)) {
		(Object.getPrototypeOf(e) !== Array.prototype || e.length > 1e4) && J(t), Object.keys(i).some((e) => e !== "length" && !/^(?:0|[1-9]\d*)$/.test(e)) && J(t);
		for (let a = 0; a < e.length; a++) {
			let e = i[String(a)];
			(!e || !Object.hasOwn(e, "value")) && J(t), fv(e.value, t, n + 1, r);
		}
		return;
	}
	(Object.getPrototypeOf(e) !== Object.prototype || Object.keys(i).length > 1e3) && J(t);
	for (let [e, a] of Object.entries(i)) ([
		"__proto__",
		"prototype",
		"constructor"
	].includes(e) || !a.enumerable || !Object.hasOwn(a, "value")) && J(t), fv(a.value, t, n + 1, r);
}
function pv(e, t, n, r = []) {
	(!e || typeof e != "object" || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype) && J(t);
	let i = e;
	return (n.some((e) => !Object.hasOwn(i, e)) || Object.keys(i).some((e) => !n.includes(e) && !r.includes(e))) && J(t), i;
}
function mv(e, t, n = 8e3) {
	(typeof e != "string" || !e.trim() || e.length > n || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(e)) && J(t);
}
function hv(e, t) {
	(typeof e != "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(e)) && J(t);
}
function gv(e, t) {
	(typeof e != "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(e)) && J(t);
}
function _v(e, t, n) {
	(!Array.isArray(e) || e.length > n) && J(t);
}
function vv(e, t) {
	new Set(e).size !== e.length && J(t);
}
function yv(e, t) {
	let n = pv(e, t, ["from", "to"]);
	return uh(n.from, t), uh(n.to, t), n.from > n.to && J(t), {
		from: n.from,
		to: n.to
	};
}
function bv(e, t) {
	if (Object.is(e, t)) return !0;
	if (!e || !t || typeof e != "object" || typeof t != "object") return !1;
	if (Array.isArray(e) || Array.isArray(t)) return Array.isArray(e) && Array.isArray(t) && e.length === t.length && e.every((e, n) => bv(e, t[n]));
	let n = e, r = t;
	return Object.keys(n).length === Object.keys(r).length && Object.keys(n).every((e) => Object.hasOwn(r, e) && bv(n[e], r[e]));
}
function xv(e, t) {
	fv(e, "today.input");
	let n = pv(e, "today.input", [
		"title",
		"date",
		"request",
		"selections"
	]);
	mv(n.title, "today.title"), uh(n.date, "today.date");
	let r = pv(n.request, "today.request", [], t === "dashboard" ? ["period"] : [
		"period",
		"asOf",
		"branch",
		"customerId",
		"orderId",
		"sourceIds",
		"onDate",
		"ritual"
	]);
	Object.hasOwn(r, "period") && yv(r.period, "today.request.period"), Object.hasOwn(r, "asOf") && dh(r.asOf, "today.request.asOf"), Object.hasOwn(r, "onDate") && uh(r.onDate, "today.request.onDate");
	for (let e of [
		"branch",
		"customerId",
		"orderId"
	]) Object.hasOwn(r, e) && mv(r[e], `today.request.${e}`, 200);
	Object.hasOwn(r, "ritual") && r.ritual !== "monday" && r.ritual !== "friday" && J("today.request.ritual"), Object.hasOwn(r, "sourceIds") && (_v(r.sourceIds, "today.request.sourceIds", 64), r.sourceIds.forEach((e) => gv(e, "today.request.sourceIds")), vv(r.sourceIds, "today.request.sourceIds")), _v(n.selections, "today.selections", 3);
	let i = t === "dashboard" ? cv : lv;
	return vv(n.selections.map((e) => {
		let t = pv(e, "today.selection", ["operation", "figureKey"]);
		return (typeof t.operation != "string" || !i.includes(t.operation)) && J("today.selection.operation"), hv(t.figureKey, "today.selection.figureKey"), t.figureKey.length > 64 && J("today.selection.figureKey"), {
			operation: t.operation,
			figureKey: t.figureKey
		};
	}).map((e) => `${e.operation}:${e.figureKey}`), "today.selections"), dv(structuredClone(e));
}
function Sv(e) {
	fv(e, "dashboard");
	let t = pv(e, "dashboard", [
		"workspace",
		"calculations",
		"factCount",
		"sources",
		"decisions",
		"waitingActions",
		"jobs",
		"policy",
		"dictionary",
		"lastActivity"
	]), n = pv(t.workspace, "dashboard.workspace", [
		"id",
		"name",
		"currency",
		"demo",
		"createdAt"
	]);
	hv(n.id, "dashboard.workspace.id"), mv(n.name, "dashboard.workspace.name"), dh(n.createdAt, "dashboard.workspace.createdAt"), (typeof n.demo != "boolean" || typeof n.currency != "string" || !/^[A-Z]{3}$/.test(n.currency)) && J("dashboard.workspace");
	for (let e of ["factCount", "sources"]) (typeof t[e] != "number" || !Number.isSafeInteger(t[e]) || t[e] < 0) && J(`dashboard.${e}`);
	for (let e of [
		"decisions",
		"waitingActions",
		"jobs"
	]) _v(t[e], `dashboard.${e}`, 1e4);
	_v(t.lastActivity, "dashboard.lastActivity", 8), (!t.policy || typeof t.policy != "object" || Array.isArray(t.policy) || t.dictionary !== null && (!t.dictionary || typeof t.dictionary != "object" || Array.isArray(t.dictionary))) && J("dashboard.metadata"), _v(t.calculations, "dashboard.calculations", 4), t.calculations.length !== 4 && J("dashboard.calculations");
	let r = [], i = [], a = [];
	for (let e of t.calculations) {
		(!e || typeof e != "object" || Array.isArray(e)) && J("dashboard.calculations");
		let t = e.operation;
		(typeof t != "string" || !cv.includes(t)) && J("dashboard.calculations.operation"), a.push(t), Object.hasOwn(e, "error") ? (mv(pv(e, "dashboard.calculation.error", ["operation", "error"]).error, "dashboard.calculation.error"), i.push(t)) : r.push(Mh(e));
	}
	return vv(a, "dashboard.calculations.operation"), vv(r.map((e) => e.id), "dashboard.receipts"), dv({
		receipts: r,
		unavailableOperations: i
	});
}
function Cv(e) {
	fv(e, "brief");
	let t = pv(e, "brief", [
		"id",
		"ritual",
		"onDate",
		"headline",
		"report",
		"decisions",
		"compliance",
		"delivery",
		"receiptIds"
	]);
	hv(t.id, "brief.id"), uh(t.onDate, "brief.onDate"), mv(t.headline, "brief.headline"), t.ritual !== "monday" && t.ritual !== "friday" && J("brief.ritual"), _v(t.decisions, "brief.decisions", 1e4);
	let n = pv(t.compliance, "brief.compliance", [
		"entries",
		"calendarVersion",
		"status"
	]);
	_v(n.entries, "brief.compliance.entries", 1e4), n.calendarVersion !== null && mv(n.calendarVersion, "brief.compliance.calendarVersion"), mv(n.status, "brief.compliance.status");
	let r = pv(t.delivery, "brief.delivery", [
		"state",
		"channels",
		"requiresApproval"
	]);
	(r.state !== "draft" || r.requiresApproval !== !0 || !bv(r.channels, ["email", "whatsapp"])) && J("brief.delivery");
	let i = pv(t.report, "brief.report", [
		"id",
		"title",
		"type",
		"createdAt",
		"status",
		"sections",
		"receiptIds",
		"rowIds",
		"gaps",
		"html",
		"delivery"
	]);
	hv(i.id, "brief.report.id"), mv(i.title, "brief.report.title"), dh(i.createdAt, "brief.report.createdAt"), (i.type !== "investor" || i.status !== "partial" && i.status !== "review-ready" || i.delivery !== "local-draft") && J("brief.report"), typeof i.html != "string" && J("brief.report.html"), _v(i.gaps, "brief.report.gaps", 1e3), i.gaps.forEach((e) => mv(e, "brief.report.gaps", 1e5)), _v(i.rowIds, "brief.report.rowIds", 1e4), i.rowIds.forEach((e) => hv(e, "brief.report.rowIds")), vv(i.rowIds, "brief.report.rowIds"), _v(i.sections, "brief.report.sections", 5);
	let a = i.sections.map((e) => {
		let t = pv(e, "brief.section", [
			"title",
			"receiptId",
			"figures",
			"period",
			"asOf",
			"dictionaryHash",
			"coverage",
			"explanation"
		]);
		return (typeof t.title != "string" || !lv.includes(t.title)) && J("brief.section.title"), hv(t.receiptId, "brief.section.receiptId"), mv(t.dictionaryHash, "brief.section.dictionaryHash"), mv(t.explanation, "brief.section.explanation", 1e5), t.period !== null && yv(t.period, "brief.section.period"), dh(t.asOf, "brief.section.asOf"), _v(t.figures, "brief.section.figures", 120), {
			operation: t.title,
			receiptId: t.receiptId,
			shared: t
		};
	}), o = a.map((e) => e.receiptId);
	return vv(o, "brief.sections"), vv(a.map((e) => e.operation), "brief.sections.operation"), (!bv(i.receiptIds, o) || !bv(t.receiptIds, o)) && J("brief.receiptIds"), dv({
		sections: structuredClone(a),
		rawGaps: [...i.gaps],
		evidence: {
			id: t.id,
			ritual: t.ritual,
			onDate: t.onDate,
			headline: t.headline,
			report: {
				id: i.id,
				title: i.title,
				type: "investor",
				createdAt: i.createdAt,
				status: i.status,
				gaps: [],
				delivery: "local-draft"
			},
			delivery: {
				state: "draft",
				channels: ["email", "whatsapp"],
				requiresApproval: !0
			}
		}
	});
}
function wv(e, t) {
	(!bv(e.period, t.period ?? null) || e.branch !== (t.branch ?? null)) && J("today.receipt.scope"), bv(e.requestedSourceIds, t.sourceIds) || J("today.receipt.requestedSourceIds"), t.asOf !== void 0 && e.asOf !== new Date(t.asOf).toISOString() && J("today.receipt.asOf");
}
function Tv(e, t) {
	fv(e, "today.receipts"), _v(e, "today.receipts", 5);
	let n = e.map(jh);
	return vv(n.map((e) => e.id), "today.receipts"), (n.length !== t.length || t.some((e) => !n.some((t) => t.id === e))) && J("today.receipts.identity"), t.map((e) => n.find((t) => t.id === e));
}
function Ev(e, t, n, r) {
	let i = [], a = [], o = [];
	for (let e of n.selections) {
		let n = t.find((t) => t.operation === e.operation);
		if (!n) {
			o.push({
				...e,
				reasonCode: "CALCULATION_UNAVAILABLE"
			});
			continue;
		}
		let r = n.figures.find((t) => t.key === e.figureKey);
		if (!r) {
			o.push({
				...e,
				reasonCode: "FIGURE_NOT_PROVIDED"
			});
			continue;
		}
		try {
			let t = V_(n, e.figureKey), o = `${e.operation}:${e.figureKey}`;
			i.push({
				id: o,
				label: r.label,
				figure: t,
				chart: null
			}), a.push({
				statId: o,
				operation: e.operation,
				figureKey: e.figureKey,
				receiptId: n.id,
				engineFigure: r,
				scope: {
					period: n.period,
					asOf: n.asOf,
					branch: n.branch,
					currency: n.currency,
					...n.requestedSourceIds === void 0 ? {} : { requestedSourceIds: n.requestedSourceIds }
				},
				coverage: n.coverage
			});
		} catch (t) {
			if (!(t instanceof B_)) throw t;
			o.push({
				...e,
				reasonCode: "UNSUPPORTED_PRESENTATION_CURRENCY"
			});
		}
	}
	return dv({
		source: e,
		today: Ah({
			title: n.title,
			date: n.date,
			pendingCount: null,
			attention: [],
			worthLook: [],
			stats: i,
			dayEvents: [],
			state: {
				kind: "partial",
				asOf: null,
				reasonCode: "TODAY_ENGINE_CONTRACT_PARTIAL"
			}
		}),
		receipts: t,
		statsEvidence: a,
		unavailableSelections: o,
		unavailable: uv,
		...r ? { brief: r } : {}
	});
}
function Dv(e, t, n) {
	let r = xv(n, "dashboard"), i = Sv(e), a = Tv(t, i.receipts.map((e) => e.id));
	for (let e of a) {
		wv(e, r.request);
		let t = i.receipts.find((t) => t.id === e.id);
		for (let n of [...Eh, "requestedSourceIds"]) n !== "stale" && !bv(t[n], e[n]) && J("dashboard.receipt.binding");
	}
	return Ev("dashboard", a, r);
}
function Ov(e, t, n) {
	let r = xv(n, "brief"), i = Cv(e), a = Tv(t, i.sections.map((e) => e.receiptId));
	r.request.onDate !== void 0 && i.evidence.onDate !== r.request.onDate && J("brief.onDate"), i.evidence.ritual !== (r.request.ritual ?? "monday") && J("brief.ritual");
	for (let e of a) {
		wv(e, r.request);
		let t = i.sections.find((t) => t.receiptId === e.id);
		t.operation !== e.operation && J("brief.receipt.operation");
		for (let n of [
			"figures",
			"period",
			"asOf",
			"dictionaryHash",
			"coverage",
			"explanation"
		]) bv(t.shared[n], e[n]) || J("brief.receipt.binding");
	}
	let o = a.flatMap((e) => e.coverage.gaps), s = i.rawGaps.filter((e) => o.includes(e) || e === "This is an investor data annex. It does not provide a valuation or certify unimported metrics.");
	return Ev("brief", a, r, {
		...i.evidence,
		report: {
			...i.evidence.report,
			gaps: s
		}
	});
}
function kv(e) {
	throw Object.freeze({ code: e });
}
function Av(e, t, n, r) {
	let i = Symbol(), a = () => {
		i = Symbol(), r.invalidate();
	}, o = async (e) => {
		let t = [];
		for (let n of e) {
			let e = await r.receipt(n);
			e.ok || kv(e.code), t.push(e.value);
		}
		return t;
	};
	return Object.freeze({
		environment: e,
		invalidate: a,
		dashboard(e) {
			let n = i, r;
			return R_(async () => (r = xv(e, "dashboard"), t(r.request)), async (e) => {
				let t = Sv(e);
				return Dv(e, await o(t.receipts.map((e) => e.id)), r);
			}, () => i === n, a);
		},
		brief(e) {
			let t = i, r;
			return R_(async () => (r = xv(e, "brief"), n(r.request)), async (e) => {
				let t = Cv(e);
				return Ov(e, await o(t.sections.map((e) => e.receiptId)), r);
			}, () => i === t, a);
		}
	});
}
function jv(e) {
	return Av("desktop", (t) => e.request("dashboard.get", t), (t) => e.request("reports.brief", t), z_(e));
}
function Mv(e, t) {
	fv(e, "today.host");
	let n = pv(e, "today.host", [
		"source",
		"today",
		"receipts",
		"statsEvidence",
		"unavailableSelections",
		"unavailable"
	], ["brief"]);
	n.source !== "dashboard" && n.source !== "brief" && J("today.host.source");
	let r = Ah(n.today);
	(r.pendingCount !== null || r.attention.length || r.worthLook.length || r.dayEvents.length || r.state.kind !== "partial" || r.state.asOf !== null || r.state.reasonCode !== "TODAY_ENGINE_CONTRACT_PARTIAL") && J("today.host.contract"), bv(n.unavailable, uv) || J("today.host.unavailable"), _v(n.receipts, "today.host.receipts", 5);
	let i = n.receipts.map(jh);
	vv(i.map((e) => e.id), "today.host.receipts"), _v(n.statsEvidence, "today.host.statsEvidence", 3), _v(n.unavailableSelections, "today.host.unavailableSelections", 3);
	let a = n.statsEvidence.map((e) => {
		let t = pv(e, "today.host.stat", [
			"statId",
			"operation",
			"figureKey",
			"receiptId",
			"engineFigure",
			"scope",
			"coverage"
		]);
		return mv(t.operation, "today.host.stat.operation"), hv(t.figureKey, "today.host.stat.figureKey"), {
			operation: t.operation,
			figureKey: t.figureKey
		};
	}), o = n.unavailableSelections.map((e) => {
		let t = pv(e, "today.host.unavailableSelection", [
			"operation",
			"figureKey",
			"reasonCode"
		]);
		return mv(t.operation, "today.host.unavailableSelection.operation"), hv(t.figureKey, "today.host.unavailableSelection.figureKey"), (typeof t.reasonCode != "string" || ![
			"CALCULATION_UNAVAILABLE",
			"FIGURE_NOT_PROVIDED",
			"UNSUPPORTED_PRESENTATION_CURRENCY"
		].includes(t.reasonCode)) && J("today.host.unavailableSelection.reasonCode"), {
			operation: t.operation,
			figureKey: t.figureKey
		};
	}), s = {
		title: r.title,
		date: r.date,
		request: {},
		selections: [...a, ...o]
	}, c = n.source === "dashboard" ? xv(s, "dashboard") : xv(s, "brief"), l = Ev(n.source, i, c);
	if ((!bv(l.today, r) || !bv(l.statsEvidence, n.statsEvidence) || !bv(l.unavailableSelections, n.unavailableSelections)) && J("today.host.binding"), n.source === "brief" !== Object.hasOwn(n, "brief") && J("today.host.brief"), Object.hasOwn(n, "brief")) {
		let e = pv(n.brief, "today.host.brief", [
			"id",
			"ritual",
			"onDate",
			"headline",
			"report",
			"delivery"
		]);
		hv(e.id, "today.host.brief.id"), uh(e.onDate, "today.host.brief.onDate"), mv(e.headline, "today.host.brief.headline"), e.ritual !== "monday" && e.ritual !== "friday" && J("today.host.brief.ritual");
		let t = pv(e.report, "today.host.brief.report", [
			"id",
			"title",
			"type",
			"createdAt",
			"status",
			"gaps",
			"delivery"
		]);
		hv(t.id, "today.host.brief.report.id"), mv(t.title, "today.host.brief.report.title"), dh(t.createdAt, "today.host.brief.report.createdAt"), (t.type !== "investor" || t.status !== "partial" && t.status !== "review-ready" || t.delivery !== "local-draft") && J("today.host.brief.report"), _v(t.gaps, "today.host.brief.report.gaps", 1e3), t.gaps.forEach((e) => mv(e, "today.host.brief.report.gaps", 1e5));
		let r = i.flatMap((e) => e.coverage.gaps);
		t.gaps.some((e) => typeof e != "string" || !r.includes(e) && e !== "This is an investor data annex. It does not provide a valuation or certify unimported metrics.") && J("today.host.brief.report.gaps"), bv(e.delivery, {
			state: "draft",
			channels: ["email", "whatsapp"],
			requiresApproval: !0
		}) || J("today.host.brief.delivery");
	}
	let u = sv(r, t);
	return dv({
		...u,
		data: {
			...u.data,
			earlierTodayMissing: "unknown"
		},
		source: e.source,
		statsEvidence: structuredClone(e.statsEvidence),
		unavailable: uv,
		...e.brief ? { brief: structuredClone(e.brief) } : {}
	});
}
//#endregion
//#region app/ui/src/host/retained-contracts.ts
function Y(e) {
	throw new $m(e);
}
var Nv = /^[a-f0-9]{64}$/, Pv = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/, Fv = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
function Iv(e, t) {
	(typeof e != "object" || !e || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype || Object.getOwnPropertySymbols(e).length) && Y(t);
	for (let [n, r] of Object.entries(Object.getOwnPropertyDescriptors(e))) ([
		"__proto__",
		"prototype",
		"constructor"
	].includes(n) || !r.enumerable || !Object.hasOwn(r, "value") || r.value === void 0) && Y(t);
	return e;
}
function Lv(e, t, n, r = []) {
	let i = Iv(e, t);
	return (n.some((e) => !Object.hasOwn(i, e)) || Object.keys(i).some((e) => !n.includes(e) && !r.includes(e))) && Y(t), i;
}
function Rv(e, t, n) {
	(!Array.isArray(e) || Object.getPrototypeOf(e) !== Array.prototype || e.length > n || Object.getOwnPropertySymbols(e).length) && Y(t);
	let r = Object.getOwnPropertyDescriptors(e);
	Object.keys(r).length !== e.length + 1 && Y(t);
	for (let n = 0; n < e.length; n++) {
		let e = r[String(n)];
		(!e?.enumerable || !Object.hasOwn(e, "value") || e.value === void 0) && Y(t);
	}
	return e;
}
function zv(e, t, n = 8e3, r = !1) {
	return (typeof e != "string" || e.length > n || !r && e.trim().length === 0 || Fv.test(e)) && Y(t), e;
}
function Bv(e, t) {
	let n = zv(e, t, 200);
	return Pv.test(n) || Y(t), n;
}
function Vv(e, t) {
	return (typeof e != "string" || !Nv.test(e)) && Y(t), e;
}
function Hv(e, t) {
	return dh(e, t), e;
}
function Uv(e, t) {
	let n = zv(e, t, 200);
	return Number.isFinite(Date.parse(n)) || Y(t), n;
}
function Wv(e, t) {
	return typeof e != "boolean" && Y(t), e;
}
function Gv(e, t, n) {
	return (typeof e != "string" || !n.some((t) => t === e)) && Y(t), e;
}
function Kv(e, t, n) {
	let r = Rv(e, t, n).map((e, n) => Bv(e, `${t}[${n}]`));
	return new Set(r).size !== r.length && Y(t), r;
}
function qv(e, t, n = 256) {
	let r = Rv(e, t, n).map((e, n) => zv(e, `${t}[${n}]`, 200));
	r.length === 0 && Y(t);
	for (let e = 1; e < r.length; e++) {
		let n = r[e - 1], i = r[e];
		(n === void 0 || i === void 0 || !(n < i)) && Y(t);
	}
	return r;
}
function Jv(e, t) {
	return (typeof e != "string" || e.length > 256 || !/^-?\d+$/.test(e)) && Y(t), e;
}
function Yv(e, t) {
	if (Object.is(e, t)) return !0;
	if (e === null || t === null || typeof e != "object" || typeof t != "object") return !1;
	if (Array.isArray(e) || Array.isArray(t)) return Array.isArray(e) && Array.isArray(t) && e.length === t.length && e.every((e, n) => Yv(e, t[n]));
	let n = e, r = t, i = Object.keys(n);
	return i.length === Object.keys(r).length && i.every((e) => Object.hasOwn(r, e) && Yv(n[e], r[e]));
}
function Xv(e) {
	if (typeof e == "object" && e) {
		for (let t of Object.values(e)) Xv(t);
		Object.freeze(e);
	}
	return e;
}
function Zv(e, t, n = 0) {
	if (n > 12 && Y(t), e === null || typeof e == "boolean") return e;
	if (typeof e == "string") return zv(e, t, 1e5, !0);
	if (typeof e == "number") return Number.isFinite(e) || Y(t), e;
	if (Array.isArray(e)) return Rv(e, t, 1e4).map((e, r) => Zv(e, `${t}[${r}]`, n + 1));
	let r = Iv(e, t);
	Object.keys(r).length > 1e3 && Y(t);
	let i = {};
	for (let [e, a] of Object.entries(r)) i[e] = Zv(a, `${t}.${e}`, n + 1);
	return i;
}
function Qv(e, t) {
	let n = Iv(e, t), r = {}, i = Object.entries(n);
	(i.length === 0 || i.length > 1e3) && Y(t);
	for (let [e, n] of i) zv(e, `${t}.key`, 200), r[e] = zv(n, `${t}.${e}`, 2e3);
	return r;
}
function $v(e) {
	let t = Lv(e, "scenario.selection", ["scenarioId", "revisionId"]);
	return Xv({
		scenarioId: Bv(t.scenarioId, "scenario.selection.scenarioId"),
		revisionId: Bv(t.revisionId, "scenario.selection.revisionId")
	});
}
function ey(e, t) {
	let n = Lv(e, t, ["from", "to"]), r = zv(n.from, `${t}.from`, 10), i = zv(n.to, `${t}.to`, 10);
	return (!/^\d{4}-\d{2}-\d{2}$/.test(r) || !/^\d{4}-\d{2}-\d{2}$/.test(i) || r > i) && Y(t), {
		from: r,
		to: i
	};
}
var ty = [
	"sourceIds",
	"period",
	"asOf",
	"branch",
	"customerId",
	"orderId",
	"comparePeriod",
	"onDate",
	"assumptions"
];
function ny(e, t) {
	let n = Lv(e, t, ["operation"], ty), r = { operation: Bv(n.operation, `${t}.operation`) };
	if (Object.hasOwn(n, "sourceIds")) {
		let e = Rv(n.sourceIds, `${t}.sourceIds`, 64).map((e, n) => {
			let r = zv(e, `${t}.sourceIds[${n}]`, 200);
			return /^[A-Za-z0-9_.:-]{1,200}$/.test(r) || Y(`${t}.sourceIds[${n}]`), r;
		});
		new Set(e).size !== e.length && Y(`${t}.sourceIds`), r.sourceIds = e;
	}
	Object.hasOwn(n, "period") && (r.period = ey(n.period, `${t}.period`)), Object.hasOwn(n, "comparePeriod") && (r.comparePeriod = ey(n.comparePeriod, `${t}.comparePeriod`));
	for (let e of [
		"asOf",
		"branch",
		"customerId",
		"orderId",
		"onDate"
	]) Object.hasOwn(n, e) && (r[e] = zv(n[e], `${t}.${e}`, 200));
	return r.asOf !== void 0 && !Number.isFinite(Date.parse(r.asOf)) && Y(`${t}.asOf`), Object.hasOwn(n, "assumptions") && (r.assumptions = { priceChangeBps: Jv(Lv(n.assumptions, `${t}.assumptions`, ["priceChangeBps"]).priceChangeBps, `${t}.assumptions.priceChangeBps`) }), r;
}
function ry(e, t) {
	let n = Lv(e, t, [
		"id",
		"label",
		"role",
		"assumptionRevisionId",
		"priceChangeBps",
		"rootJobId"
	]);
	return {
		id: Bv(n.id, `${t}.id`),
		label: zv(n.label, `${t}.label`, 200),
		role: Gv(n.role, `${t}.role`, ["baseline", "alternative"]),
		assumptionRevisionId: Bv(n.assumptionRevisionId, `${t}.assumptionRevisionId`),
		priceChangeBps: Jv(n.priceChangeBps, `${t}.priceChangeBps`),
		rootJobId: Bv(n.rootJobId, `${t}.rootJobId`)
	};
}
function iy(e, t) {
	let n = Lv(e, t, [
		"id",
		"branchId",
		"label",
		"dependsOn",
		"usesBranchAssumptions",
		"request",
		"authoredRequest",
		"authoredRequestDigest",
		"requestDigest",
		"inputDigest"
	]), r = {
		id: Bv(n.id, `${t}.id`),
		branchId: Bv(n.branchId, `${t}.branchId`),
		label: zv(n.label, `${t}.label`, 200),
		dependsOn: Kv(n.dependsOn, `${t}.dependsOn`, 1e3),
		usesBranchAssumptions: Wv(n.usesBranchAssumptions, `${t}.usesBranchAssumptions`),
		request: ny(n.request, `${t}.request`),
		authoredRequest: ny(n.authoredRequest, `${t}.authoredRequest`),
		authoredRequestDigest: Vv(n.authoredRequestDigest, `${t}.authoredRequestDigest`),
		requestDigest: Vv(n.requestDigest, `${t}.requestDigest`),
		inputDigest: Vv(n.inputDigest, `${t}.inputDigest`)
	};
	return r.request.asOf === void 0 && Y(`${t}.request.asOf`), r.usesBranchAssumptions && r.request.assumptions === void 0 && Y(`${t}.request.assumptions`), r;
}
function ay(e, t) {
	let n = Lv(e, t, [
		"id",
		"scenarioId",
		"parentRevisionId",
		"mode",
		"createdAt",
		"evidenceId",
		"evidenceDigest",
		"branches",
		"jobs",
		"digest"
	]), r = Rv(n.branches, `${t}.branches`, 200).map((e, n) => ry(e, `${t}.branches[${n}]`)), i = Rv(n.jobs, `${t}.jobs`, 1e3).map((e, n) => iy(e, `${t}.jobs[${n}]`));
	(r.length === 0 || new Set(r.map((e) => e.id)).size !== r.length) && Y(`${t}.branches`), r.filter((e) => e.role === "baseline").length !== 1 && Y(`${t}.branches`);
	let a = r.find((e) => e.role === "baseline");
	(a === void 0 || !/^-?0+$/.test(a.priceChangeBps)) && Y(`${t}.branches.baseline`), (i.length === 0 || new Set(i.map((e) => e.id)).size !== i.length) && Y(`${t}.jobs`);
	for (let e of r) {
		let n = i.find((t) => t.id === e.rootJobId);
		(n === void 0 || n.branchId !== e.id) && Y(`${t}.branches.rootJobId`);
	}
	for (let e of i) {
		let n = r.find((t) => t.id === e.branchId);
		n === void 0 && Y(`${t}.jobs.branchId`), e.usesBranchAssumptions && e.request.assumptions?.priceChangeBps !== n.priceChangeBps && Y(`${t}.jobs.assumption`);
		for (let n of e.dependsOn) {
			let r = i.find((e) => e.id === n);
			(r === void 0 || r.branchId !== e.branchId || r.id === e.id) && Y(`${t}.jobs.dependsOn`);
		}
	}
	return {
		id: Bv(n.id, `${t}.id`),
		scenarioId: Bv(n.scenarioId, `${t}.scenarioId`),
		parentRevisionId: n.parentRevisionId === null ? null : Bv(n.parentRevisionId, `${t}.parentRevisionId`),
		mode: Gv(n.mode, `${t}.mode`, [
			"initial",
			"assumption-change",
			"graph-change",
			"current-state-recompute"
		]),
		createdAt: Hv(n.createdAt, `${t}.createdAt`),
		evidenceId: Bv(n.evidenceId, `${t}.evidenceId`),
		evidenceDigest: Vv(n.evidenceDigest, `${t}.evidenceDigest`),
		branches: r,
		jobs: i,
		digest: Vv(n.digest, `${t}.digest`)
	};
}
function oy(e, t) {
	let n = Lv(e, t, ["jobId", "status"], [
		"runId",
		"activeRunId",
		"retainedRunId",
		"reusedFromRevisionId"
	]), r = {
		jobId: Bv(n.jobId, `${t}.jobId`),
		status: Gv(n.status, `${t}.status`, [
			"pending",
			"stale",
			"running",
			"ready"
		])
	};
	for (let e of [
		"runId",
		"activeRunId",
		"retainedRunId",
		"reusedFromRevisionId"
	]) Object.hasOwn(n, e) && (r[e] = Bv(n[e], `${t}.${e}`));
	return (r.status === "ready" ? r.runId === void 0 : r.runId !== void 0) && Y(`${t}.runId`), r.status !== "running" && r.activeRunId !== void 0 && Y(`${t}.activeRunId`), r;
}
function sy(e, t) {
	let n = Lv(e, t, [
		"runId",
		"runDigest",
		"receipt",
		"receiptDigest",
		"digest"
	]);
	return {
		runId: Bv(n.runId, `${t}.runId`),
		runDigest: Vv(n.runDigest, `${t}.runDigest`),
		receipt: Mh(n.receipt),
		receiptDigest: Vv(n.receiptDigest, `${t}.receiptDigest`),
		digest: Vv(n.digest, `${t}.digest`)
	};
}
function cy(e, t, n) {
	let r = e.request, i = t.receipt;
	i.operation !== r.operation && Y(`${n}.operation`), (!Yv(i.period, r.period ?? null) || !Yv(i.comparePeriod, r.comparePeriod ?? null) || i.branch !== (r.branch ?? null)) && Y(`${n}.scope`), r.asOf !== void 0 && Date.parse(i.asOf) !== Date.parse(r.asOf) && Y(`${n}.asOf`), (r.sourceIds === void 0 ? i.requestedSourceIds !== void 0 : !Yv(i.requestedSourceIds, r.sourceIds)) && Y(`${n}.requestedSourceIds`);
	let a = r.assumptions?.priceChangeBps, o = Object.hasOwn(i.assumptions, "priceChangeBps") ? i.assumptions.priceChangeBps : void 0;
	(a === void 0 ? o !== void 0 : typeof o != "string" || !/^-?\d+$/.test(o) || BigInt(o) !== BigInt(a)) && Y(`${n}.assumptions`), Object.hasOwn(i.assumptions, "onDate") && i.assumptions.onDate !== (r.onDate ?? new Date(Date.parse(i.asOf)).toISOString().slice(0, 10)) && Y(`${n}.assumptions.onDate`);
}
function ly(e, t) {
	let n = Lv(e, t, [
		"id",
		"scenarioId",
		"revisionId",
		"revisionDigest",
		"evidenceId",
		"evidenceDigest",
		"createdAt",
		"requiredJobs",
		"noAction",
		"limitations",
		"digest"
	]);
	n.noAction !== !0 && Y(`${t}.noAction`);
	let r = Rv(n.requiredJobs, `${t}.requiredJobs`, 1e3).map((e, n) => {
		let r = `${t}.requiredJobs[${n}]`, i = Lv(e, r, [
			"jobId",
			"branchId",
			"requestDigest",
			"inputDigest",
			"runId",
			"runRevisionId",
			"receiptId",
			"receiptDigest",
			"reusedFromRevisionId"
		]);
		return {
			jobId: Bv(i.jobId, `${r}.jobId`),
			branchId: Bv(i.branchId, `${r}.branchId`),
			requestDigest: Vv(i.requestDigest, `${r}.requestDigest`),
			inputDigest: Vv(i.inputDigest, `${r}.inputDigest`),
			runId: Bv(i.runId, `${r}.runId`),
			runRevisionId: Bv(i.runRevisionId, `${r}.runRevisionId`),
			receiptId: Bv(i.receiptId, `${r}.receiptId`),
			receiptDigest: Vv(i.receiptDigest, `${r}.receiptDigest`),
			reusedFromRevisionId: i.reusedFromRevisionId === null ? null : Bv(i.reusedFromRevisionId, `${r}.reusedFromRevisionId`)
		};
	});
	return new Set(r.map((e) => e.jobId)).size !== r.length && Y(`${t}.requiredJobs`), {
		id: Bv(n.id, `${t}.id`),
		scenarioId: Bv(n.scenarioId, `${t}.scenarioId`),
		revisionId: Bv(n.revisionId, `${t}.revisionId`),
		revisionDigest: Vv(n.revisionDigest, `${t}.revisionDigest`),
		evidenceId: Bv(n.evidenceId, `${t}.evidenceId`),
		evidenceDigest: Vv(n.evidenceDigest, `${t}.evidenceDigest`),
		createdAt: Hv(n.createdAt, `${t}.createdAt`),
		requiredJobs: r,
		noAction: !0,
		limitations: Rv(n.limitations, `${t}.limitations`, 100).map((e, n) => zv(e, `${t}.limitations[${n}]`, 2e3)),
		digest: Vv(n.digest, `${t}.digest`)
	};
}
function uy(e, t) {
	let n = "scenario.view", r = Lv(e, n, [
		"scenarioId",
		"headRevisionId",
		"mode",
		"revision",
		"jobs",
		"status",
		"results",
		"comparisons",
		"noAction"
	]);
	(r.mode !== "retained-revision" || r.noAction !== !0) && Y(n);
	let i = Bv(r.scenarioId, `${n}.scenarioId`), a = Bv(r.headRevisionId, `${n}.headRevisionId`), o = ay(r.revision, `${n}.revision`);
	(i !== t.scenarioId || o.id !== t.revisionId || o.scenarioId !== i) && Y(`${n}.identity`);
	let s = Rv(r.jobs, `${n}.jobs`, 1e3).map((e, t) => oy(e, `${n}.jobs[${t}]`));
	(s.length !== o.jobs.length || new Set(s.map((e) => e.jobId)).size !== s.length || s.some((e) => !o.jobs.some((t) => t.id === e.jobId))) && Y(`${n}.jobs`);
	let c = /* @__PURE__ */ new Set();
	for (let e of s) for (let t of [
		e.runId,
		e.activeRunId,
		e.retainedRunId
	]) t !== void 0 && (c.has(t) && Y(`${n}.jobs.runOwnership`), c.add(t));
	let l = Gv(r.status, `${n}.status`, ["partial", "complete"]);
	l === "complete" !== s.every((e) => e.status === "ready") && Y(`${n}.status`);
	let u = Rv(r.results, `${n}.results`, 1e3).map((e, t) => sy(e, `${n}.results[${t}]`));
	new Set(u.map((e) => e.runId)).size !== u.length && Y(`${n}.results`), new Set(u.map((e) => e.receipt.id)).size !== u.length && Y(`${n}.results.receiptId`);
	let d = new Set(s.flatMap((e) => [e.runId, e.retainedRunId].filter((e) => e !== void 0)));
	u.some((e) => !d.has(e.runId)) && Y(`${n}.results.runId`);
	for (let e of s) {
		if (e.status !== "ready") continue;
		let t = o.jobs.find((t) => t.id === e.jobId), r = u.find((t) => t.runId === e.runId);
		(t === void 0 || r === void 0) && Y(`${n}.results.binding`), cy(t, r, `${n}.results.binding`);
	}
	let f = Rv(r.comparisons, `${n}.comparisons`, 100).map((e, t) => ly(e, `${n}.comparisons[${t}]`));
	new Set(f.map((e) => e.id)).size !== f.length && Y(`${n}.comparisons`);
	for (let e of f) {
		(e.scenarioId !== i || e.revisionId !== o.id || e.revisionDigest !== o.digest || e.evidenceId !== o.evidenceId || e.evidenceDigest !== o.evidenceDigest) && Y(`${n}.comparisons.revision`), e.requiredJobs.length !== o.jobs.length && Y(`${n}.comparisons.requiredJobs`);
		for (let t of e.requiredJobs) {
			let e = o.jobs.find((e) => e.id === t.jobId), r = s.find((e) => e.jobId === t.jobId), i = u.find((e) => e.runId === t.runId);
			(e === void 0 || r === void 0 || i === void 0 || r.status !== "ready" || r.runId !== t.runId || e.branchId !== t.branchId || e.requestDigest !== t.requestDigest || e.inputDigest !== t.inputDigest || i.receipt.id !== t.receiptId || i.receiptDigest !== t.receiptDigest || (r.reusedFromRevisionId ?? null) !== t.reusedFromRevisionId) && Y(`${n}.comparisons.requiredJobs`), t.reusedFromRevisionId === null && t.runRevisionId !== o.id && Y(`${n}.comparisons.runRevisionId`);
		}
	}
	return Xv({
		scenarioId: i,
		headRevisionId: a,
		mode: "retained-revision",
		revision: o,
		jobs: s,
		status: l,
		results: u,
		comparisons: f,
		noAction: !0
	});
}
function dy(e) {
	return e.revision.id !== e.headRevisionId;
}
function fy(e) {
	return [...e.revision.branches].sort((e, t) => (e.role === "baseline" ? 0 : 1) - (t.role === "baseline" ? 0 : 1)).map((t) => ({
		branch: t,
		entries: e.revision.jobs.filter((e) => e.branchId === t.id).map((t) => {
			let n = e.jobs.find((e) => e.jobId === t.id);
			if (n === void 0) throw new $m("scenario.view.jobs");
			return {
				job: t,
				state: n,
				result: n.status === "ready" ? e.results.find((e) => e.runId === n.runId) ?? null : null
			};
		})
	}));
}
function py(e) {
	return e.result === null || !e.job.usesBranchAssumptions ? null : e.result.receipt.figures.find((e) => e.key === "scenario") ?? null;
}
function my(e, t) {
	let n = e.jobs.find((e) => e.status === "ready" && e.runId === t), r = e.results.find((e) => e.runId === t), i = n === void 0 ? void 0 : e.revision.jobs.find((e) => e.id === n.jobId), a = i === void 0 ? void 0 : e.revision.branches.find((e) => e.id === i.branchId), o = e.revision.branches.find((e) => e.role === "baseline");
	return n === void 0 || r === void 0 || i === void 0 || a === void 0 || o === void 0 ? null : {
		view: e,
		branch: a,
		baseline: o,
		job: i,
		state: n,
		result: r
	};
}
var hy = [
	"owner",
	"cofounder",
	"accountant",
	"viewer"
];
function gy(e, t) {
	let n = Lv(e, t, [
		"memberId",
		"role",
		"epoch"
	]);
	return (!Number.isSafeInteger(n.epoch) || n.epoch < 1) && Y(`${t}.epoch`), {
		memberId: Bv(n.memberId, `${t}.memberId`),
		role: Gv(n.role, `${t}.role`, hy),
		epoch: n.epoch
	};
}
function _y(e, t) {
	let n = Lv(e, t, [
		"id",
		"revision",
		"digest"
	]);
	return (!Number.isSafeInteger(n.revision) || n.revision < 1) && Y(`${t}.revision`), {
		id: Bv(n.id, `${t}.id`),
		revision: n.revision,
		digest: Vv(n.digest, `${t}.digest`)
	};
}
function vy(e, t) {
	let n = Lv(e, t, [
		"id",
		"revision",
		"digest"
	]);
	return {
		id: zv(n.id, `${t}.id`, 200),
		revision: zv(n.revision, `${t}.revision`, 200),
		digest: Vv(n.digest, `${t}.digest`)
	};
}
var yy = [
	"personal-preference",
	"reminder-timing",
	"shortlist-order"
];
function by(e, t) {
	let n = Lv(e, t, [
		"pin",
		"available",
		"sourceTainted",
		"sourceMarkings",
		"summary"
	]), r = Lv(n.pin, `${t}.pin`, [
		"kind",
		"id",
		"revision",
		"digest",
		"sourceIds",
		"branchIds"
	]), i = {
		kind: Gv(r.kind, `${t}.pin.kind`, ["job", "calculation"]),
		id: zv(r.id, `${t}.pin.id`, 200),
		revision: zv(r.revision, `${t}.pin.revision`, 200),
		digest: Vv(r.digest, `${t}.pin.digest`),
		sourceIds: qv(r.sourceIds, `${t}.pin.sourceIds`),
		branchIds: qv(r.branchIds, `${t}.pin.branchIds`)
	};
	n.available !== !0 && Y(`${t}.available`), n.sourceTainted !== !1 && Y(`${t}.sourceTainted`);
	let a = Rv(n.sourceMarkings, `${t}.sourceMarkings`, 256).map((e, n) => {
		let r = Lv(e, `${t}.sourceMarkings[${n}]`, ["sourceId", "marking"]);
		return {
			sourceId: zv(r.sourceId, `${t}.sourceMarkings[${n}].sourceId`, 200),
			marking: zv(r.marking, `${t}.sourceMarkings[${n}].marking`, 2e3)
		};
	});
	return (a.length !== i.sourceIds.length || a.some((e, t) => e.sourceId !== i.sourceIds[t])) && Y(`${t}.sourceMarkings`), {
		pin: i,
		available: !0,
		sourceTainted: !1,
		sourceMarkings: a,
		summary: zv(n.summary, `${t}.summary`, 2e4)
	};
}
function xy(e, t) {
	let n = Lv(e, t, [
		"kind",
		"id",
		"revision",
		"digest",
		"owner",
		"value"
	]);
	return {
		kind: Gv(n.kind, `${t}.kind`, yy),
		id: zv(n.id, `${t}.id`, 200),
		revision: zv(n.revision, `${t}.revision`, 200),
		digest: Vv(n.digest, `${t}.digest`),
		owner: gy(n.owner, `${t}.owner`),
		value: Zv(n.value, `${t}.value`)
	};
}
function Sy(e, t) {
	let n = Lv(e, t, [
		"kind",
		"workspaceId",
		"id",
		"revision",
		"digest",
		"owner",
		"proposedBy",
		"proposedAt",
		"episodeIds",
		"title",
		"rationale",
		"evidence",
		"change",
		"applicability",
		"counterexamples",
		"target"
	], ["supersedes"]);
	n.kind !== "candidate-lesson" && Y(`${t}.kind`), (!Number.isSafeInteger(n.revision) || n.revision < 1) && Y(`${t}.revision`);
	let r = Lv(n.change, `${t}.change`, [
		"kind",
		"targetId",
		"before",
		"after"
	]), i = Lv(n.applicability, `${t}.applicability`, [
		"memberId",
		"branchIds",
		"sourceIds",
		"conditions"
	]), a = Rv(n.evidence, `${t}.evidence`, 256).map((e, n) => by(e, `${t}.evidence[${n}]`));
	(a.length === 0 || new Set(a.map((e) => `${e.pin.kind}:${e.pin.id}`)).size !== a.length) && Y(`${t}.evidence`);
	let o = {
		kind: "candidate-lesson",
		workspaceId: Bv(n.workspaceId, `${t}.workspaceId`),
		id: Bv(n.id, `${t}.id`),
		revision: n.revision,
		digest: Vv(n.digest, `${t}.digest`),
		owner: gy(n.owner, `${t}.owner`),
		proposedBy: gy(n.proposedBy, `${t}.proposedBy`),
		proposedAt: Hv(n.proposedAt, `${t}.proposedAt`),
		episodeIds: Kv(n.episodeIds, `${t}.episodeIds`, 256),
		title: zv(n.title, `${t}.title`, 2e3),
		rationale: zv(n.rationale, `${t}.rationale`, 1e5),
		evidence: a,
		change: {
			kind: Gv(r.kind, `${t}.change.kind`, yy),
			targetId: zv(r.targetId, `${t}.change.targetId`, 200),
			before: Zv(r.before, `${t}.change.before`),
			after: Zv(r.after, `${t}.change.after`)
		},
		applicability: {
			memberId: Bv(i.memberId, `${t}.applicability.memberId`),
			branchIds: qv(i.branchIds, `${t}.applicability.branchIds`, a.length * 256),
			sourceIds: qv(i.sourceIds, `${t}.applicability.sourceIds`, a.length * 256),
			conditions: Qv(i.conditions, `${t}.applicability.conditions`)
		},
		counterexamples: Rv(n.counterexamples, `${t}.counterexamples`, 1e3).map((e, n) => {
			let r = Lv(e, `${t}.counterexamples[${n}]`, ["conditions", "reason"]);
			return {
				conditions: Qv(r.conditions, `${t}.counterexamples[${n}].conditions`),
				reason: zv(r.reason, `${t}.counterexamples[${n}].reason`, 1e5)
			};
		}),
		target: xy(n.target, `${t}.target`)
	};
	Object.hasOwn(n, "supersedes") && (o.supersedes = _y(n.supersedes, `${t}.supersedes`)), o.episodeIds.length !== o.evidence.length && Y(`${t}.episodeIds`), o.counterexamples.length === 0 && Y(`${t}.counterexamples`);
	let s = [...new Set(o.evidence.flatMap((e) => e.pin.sourceIds))].sort(), c = new Set(o.evidence.flatMap((e) => e.pin.branchIds));
	return (!Yv(o.applicability.sourceIds, s) || o.applicability.branchIds.some((e) => e === "*" || !c.has(e))) && Y(`${t}.applicability`), o.applicability.memberId !== o.owner.memberId && Y(`${t}.applicability.memberId`), (o.target.kind !== o.change.kind || o.target.id !== o.change.targetId || !Yv(o.target.owner, o.owner)) && Y(`${t}.target`), Yv(o.change.before, o.change.after) && Y(`${t}.change`), o.supersedes === void 0 && !Yv(o.change.before, o.target.value) && Y(`${t}.change.before`), o;
}
function Cy(e, t, n, r) {
	let i = Lv(e, t, [
		"reference",
		"set",
		"candidate",
		"authorityId",
		"qualification",
		"suite",
		"harness",
		"build",
		"configuration",
		"comparisonId",
		"completedAt",
		"status",
		"baseline",
		"treatment",
		"metrics",
		"sourceTainted",
		"sourceIds"
	]), a = Lv(i.baseline, `${t}.baseline`, ["guidance", "digest"]), o = Lv(i.treatment, `${t}.treatment`, ["guidance", "candidate"]);
	(a.guidance !== "off" || o.guidance !== "on") && Y(`${t}.guidance`);
	let s = {
		reference: vy(i.reference, `${t}.reference`),
		set: Gv(i.set, `${t}.set`, ["open", "hidden"]),
		candidate: _y(i.candidate, `${t}.candidate`),
		authorityId: zv(i.authorityId, `${t}.authorityId`, 200),
		qualification: Gv(i.qualification, `${t}.qualification`, ["synthetic-protocol", "owner-qualified"]),
		suite: vy(i.suite, `${t}.suite`),
		harness: vy(i.harness, `${t}.harness`),
		build: vy(i.build, `${t}.build`),
		configuration: vy(i.configuration, `${t}.configuration`),
		comparisonId: zv(i.comparisonId, `${t}.comparisonId`, 200),
		completedAt: Uv(i.completedAt, `${t}.completedAt`),
		status: Gv(i.status, `${t}.status`, [
			"complete",
			"incomplete",
			"declined"
		]),
		baseline: {
			guidance: "off",
			digest: Vv(a.digest, `${t}.baseline.digest`)
		},
		treatment: {
			guidance: "on",
			candidate: _y(o.candidate, `${t}.treatment.candidate`)
		},
		metrics: Rv(i.metrics, `${t}.metrics`, 1e3).map((e, n) => {
			let r = Lv(e, `${t}.metrics[${n}]`, [
				"name",
				"direction",
				"before",
				"after"
			]);
			return (typeof r.before != "number" || !Number.isFinite(r.before) || typeof r.after != "number" || !Number.isFinite(r.after)) && Y(`${t}.metrics[${n}]`), {
				name: zv(r.name, `${t}.metrics[${n}].name`, 200),
				direction: Gv(r.direction, `${t}.metrics[${n}].direction`, ["higher-is-better", "lower-is-better"]),
				before: r.before,
				after: r.after
			};
		}),
		sourceTainted: Wv(i.sourceTainted, `${t}.sourceTainted`),
		sourceIds: qv(i.sourceIds, `${t}.sourceIds`, 1e4)
	};
	return (s.set !== n || !Yv(s.candidate, r) || !Yv(s.treatment.candidate, r)) && Y(`${t}.candidate`), new Set(s.metrics.map((e) => e.name)).size !== s.metrics.length && Y(`${t}.metrics`), s.status === "complete" && s.metrics.length === 0 && Y(`${t}.metrics`), s;
}
function wy(e, t, n) {
	let r = Lv(e, t, [
		"candidate",
		"open",
		"hidden",
		"digest"
	]), i = {
		candidate: _y(r.candidate, `${t}.candidate`),
		open: Cy(r.open, `${t}.open`, "open", n),
		hidden: Cy(r.hidden, `${t}.hidden`, "hidden", n),
		digest: Vv(r.digest, `${t}.digest`)
	};
	return Yv(i.candidate, n) || Y(`${t}.candidate`), i;
}
function Ty(e, t, n) {
	let r = Lv(e, t, [
		"id",
		"candidate",
		"evaluationDigest",
		"reviewer",
		"at",
		"digest"
	]), i = {
		id: Bv(r.id, `${t}.id`),
		candidate: _y(r.candidate, `${t}.candidate`),
		evaluationDigest: Vv(r.evaluationDigest, `${t}.evaluationDigest`),
		reviewer: gy(r.reviewer, `${t}.reviewer`),
		at: Hv(r.at, `${t}.at`),
		digest: Vv(r.digest, `${t}.digest`)
	};
	return Yv(i.candidate, n) || Y(`${t}.candidate`), i;
}
var Ey = (e) => ({
	id: e.id,
	revision: e.revision,
	digest: e.digest
});
function Dy(e, t = "lesson.view") {
	let n = Lv(e, t, ["candidate", "status"], ["evaluation", "review"]), r = Sy(n.candidate, `${t}.candidate`), i = Ey(r), a = {
		candidate: r,
		status: Gv(n.status, `${t}.status`, [
			"proposed",
			"evaluation-blocked",
			"review-ready",
			"approved",
			"rejected",
			"deferred",
			"retired",
			"superseded"
		])
	};
	return Object.hasOwn(n, "evaluation") && (a.evaluation = wy(n.evaluation, `${t}.evaluation`, i)), Object.hasOwn(n, "review") && (a.review = Ty(n.review, `${t}.review`, i), (a.evaluation === void 0 || a.review.evaluationDigest !== a.evaluation.digest) && Y(`${t}.review.evaluationDigest`)), (a.status === "review-ready" || a.status === "approved") && a.evaluation === void 0 && Y(`${t}.evaluation`), Xv(a);
}
var Oy = (e) => ({
	memberId: e.member.id,
	role: e.member.role,
	epoch: e.member.epoch
});
function ky(e, t) {
	return e.candidate.workspaceId === t.workspace.id && Yv(e.candidate.owner, Oy(t));
}
function Ay(e, t) {
	let n = Rv(e, "memory.lessons", 1e3).map((e, t) => Dy(e, `memory.lessons[${t}]`));
	return new Set(n.map((e) => e.candidate.id)).size !== n.length && Y("memory.lessons"), n.forEach((e, n) => {
		ky(e, t) || Y(`memory.lessons[${n}].release`);
	}), Xv(n);
}
function jy(e, t) {
	let n = Math.max(0, Math.ceil(t / 5) - 1);
	return Math.min(Math.max(0, Math.floor(e / 5)), n);
}
function My(e) {
	let { open: t, hidden: n } = e;
	return [t, n].every((e) => e.status === "complete" && e.metrics.length > 0 && !e.sourceTainted && e.metrics.every((e) => e.direction === "higher-is-better" ? e.after >= e.before : e.after <= e.before)) && t.comparisonId === n.comparisonId && t.baseline.digest === n.baseline.digest && t.qualification === n.qualification && Yv(t.build, n.build) && Yv(t.configuration, n.configuration);
}
function Ny(e, t) {
	let n = Oy(t);
	if (t.member.role !== "owner" && t.member.role !== "cofounder") return {
		ok: !1,
		block: "role"
	};
	if (e.candidate.workspaceId !== t.workspace.id) return {
		ok: !1,
		block: "workspace"
	};
	if (e.status !== "review-ready") return {
		ok: !1,
		block: "status"
	};
	let r = e.evaluation;
	return r === void 0 || !My(r) ? {
		ok: !1,
		block: "evaluation"
	} : e.review === void 0 || e.review.evaluationDigest !== r.digest || !Yv(e.review.candidate, Ey(e.candidate)) ? {
		ok: !1,
		block: "review"
	} : !Yv(e.review.reviewer, n) || !Yv(e.candidate.owner, n) || !Yv(e.candidate.target.owner, n) || e.candidate.applicability.memberId !== n.memberId ? {
		ok: !1,
		block: "reviewer"
	} : { ok: !0 };
}
var Py = 4e3;
function Fy(e) {
	return typeof e != "string" || e.trim().length === 0 || e.length > 4e3 || Fv.test(e) ? null : e;
}
function Iy(e, t, n) {
	if (e.review === void 0 || e.evaluation === void 0 || Fy(n) === null || t.decision !== "approve" && t.decision !== "defer" || !Yv(Ey(e.candidate), t.candidate) || e.review.id !== t.reviewId || e.review.digest !== t.reviewDigest || e.evaluation.digest !== t.evaluationDigest) throw new $m("memory.decideLesson.request");
	return Xv({
		candidate: Ey(e.candidate),
		reviewId: e.review.id,
		reviewDigest: e.review.digest,
		decision: t.decision,
		reason: n
	});
}
function Ly(e, t, n) {
	let r = Dy(e, "memory.decideLesson");
	return (r.status !== (t.decision === "approve" ? "approved" : "deferred") || r.review === void 0 || r.evaluation === void 0 || r.review.id !== t.reviewId || r.review.digest !== t.reviewDigest || !Yv(Ey(r.candidate), t.candidate) || !Yv(r.candidate, n.candidate) || !Yv(r.evaluation, n.evaluation) || !Yv(r.review, n.review)) && Y("memory.decideLesson.binding"), r;
}
function Ry(e, t) {
	return Yv(e, t);
}
var zy = [
	"SCENARIO_UNAVAILABLE",
	"SCENARIO_REVISION_UNAVAILABLE",
	"SCENARIO_EVIDENCE_UNAVAILABLE",
	"SCENARIO_FORBIDDEN",
	"SCENARIO_AUTHORITY_CHANGED",
	"SCENARIO_ARTIFACT_CHANGED",
	"SCENARIO_RETENTION_EXPIRED",
	"SCENARIO_HOST_REQUIRED",
	"SCENARIO_CUSTODY_INVALID",
	"SCENARIO_CUSTODY_CONFLICT",
	"SCENARIO_TAINTED_CONTEXT",
	"SCENARIO_WORKSPACE_CHANGED",
	"SCENARIO_RUN_UNAVAILABLE",
	"SCENARIO_READ_ONLY",
	"SCENARIO_HEAD_CHANGED",
	"SCENARIO_JOB_UNAVAILABLE",
	"SCENARIO_BRANCH_UNAVAILABLE",
	"SCENARIO_GRAPH_INVALID",
	"SCENARIO_VECTOR_MISMATCH",
	"INVALID_SCENARIO"
], By = /* @__PURE__ */ "LESSON_AUTHORITY_REQUIRED.LESSON_AUTHORITIES_REQUIRED.LESSON_AUTHORITY_REVISION_REQUIRED.LESSON_AUTHORITY_CHANGED.LESSON_REVIEW_CHANGED.LESSON_EVALUATION_BLOCKED.EVALUATION_AUTHORITY_REQUIRED.EVALUATION_CHANGED.EVALUATION_CANDIDATE_MISMATCH.EVALUATION_PROVENANCE_REQUIRED.EVALUATION_COMPARISON_MISMATCH.INVALID_LESSON_EVALUATION.LESSON_EVIDENCE_UNAVAILABLE.LESSON_EVIDENCE_CHANGED.LESSON_TARGET_CHANGED.LESSON_OWNER_REQUIRED.LESSON_WORKSPACE_CHANGED.LESSON_NOT_FOUND.LESSON_CHANGED.INVALID_LESSON.INVALID_LESSON_DECISION.INVALID_LESSON_STATE.INVALID_LESSON_TARGET.INVALID_LESSON_STATE_NAMESPACE.APP_LESSON_REVIEW_REQUIRED.TAINTED_LESSON.LESSON_CONFLICT.INVALID_SUPERSESSION.PROTECTED_LESSON_TARGET".split("."), Vy = [...zy, ...By];
function Hy(e) {
	if (e instanceof $m) return "INVALID_REPLY";
	let t;
	try {
		t = typeof e == "object" && e ? Object.getOwnPropertyDescriptor(e, "code") : void 0;
	} catch {
		return "REQUEST_FAILED";
	}
	let n = t && Object.hasOwn(t, "value") ? t.value : void 0;
	return n === "INVALID_REQUEST" ? "UNSUPPORTED_TRANSPORT" : typeof n == "string" && Vy.includes(n) ? n : n === "FORBIDDEN" || n === "ACCESS_REVOKED" ? "ACCESS_DENIED" : L_(e);
}
function Uy(e) {
	return e === "UNSUPPORTED_TRANSPORT" || e === "SCENARIO_HOST_REQUIRED" || e === "LESSON_AUTHORITY_REQUIRED" || e === "LESSON_AUTHORITIES_REQUIRED" || e === "EVALUATION_AUTHORITY_REQUIRED";
}
var X = {
	page: "_page_ons6j_4",
	scenario: "_scenario_ons6j_5",
	group: "_group_ons6j_6",
	title: "_title_ons6j_13",
	heading: "_heading_ons6j_22",
	identity: "_identity_ons6j_30",
	text: "_text_ons6j_31",
	note: "_note_ons6j_37",
	table: "_table_ons6j_48",
	head: "_head_ons6j_22",
	column: "_column_ons6j_62",
	columnLabel: "_columnLabel_ons6j_68",
	cell: "_cell_ons6j_74",
	jobs: "_jobs_ons6j_79",
	list: "_list_ons6j_80",
	job: "_job_ons6j_79",
	jobTitle: "_jobTitle_ons6j_95",
	state: "_state_ons6j_101",
	figures: "_figures_ons6j_110",
	pairs: "_pairs_ons6j_111",
	pair: "_pair_ons6j_111",
	value: "_value_ons6j_128",
	name: "_name_ons6j_132",
	figure: "_figure_ons6j_110",
	label: "_label_ons6j_150",
	actions: "_actions_ons6j_154"
}, Wy = {
	pending: "busy",
	running: "busy",
	stale: "unsure",
	ready: "cha"
};
function Gy({ name: e, mono: t = !1, children: n }) {
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: X.pair,
		children: [/* @__PURE__ */ (0, A.jsx)("dt", {
			className: X.name,
			children: e
		}), /* @__PURE__ */ (0, A.jsx)("dd", {
			className: [X.value, t ? "fig" : ""].filter(Boolean).join(" "),
			children: n
		})]
	});
}
function Ky(e, t) {
	return t.unit === "money" ? t.currency === void 0 ? e("ASK.answer.figure.money", { exact: t.minor }) : e("ASK.answer.figure.money.currency", {
		exact: t.minor,
		currency: t.currency
	}) : t.currency === void 0 ? e("ASK.answer.figure.points", { exact: t.minor }) : e("ASK.answer.figure.points.currency", {
		exact: t.minor,
		currency: t.currency
	});
}
function qy(e) {
	return e.coverage.completeness === "empty" || e.coverage.completeness === "partial" && e.coverage.countedRows === 0;
}
function Jy({ entry: e, view: t, checking: n, onProof: r }) {
	let i = j(), a = e.result;
	if (a === null) return null;
	let o = a.receipt;
	return qy(o) ? /* @__PURE__ */ (0, A.jsx)("dl", {
		className: X.figures,
		children: /* @__PURE__ */ (0, A.jsxs)("div", {
			className: X.pair,
			children: [/* @__PURE__ */ (0, A.jsx)("dt", { children: i("ASK.answer.calculation.figure") }), /* @__PURE__ */ (0, A.jsx)("dd", {
				className: X.value,
				children: /* @__PURE__ */ (0, A.jsx)(Lp, { missing: "unknown" })
			})]
		})
	}) : o.figures.length === 0 ? /* @__PURE__ */ (0, A.jsx)("p", {
		className: X.note,
		children: i("ASK.answer.calculation.noFigures")
	}) : /* @__PURE__ */ (0, A.jsx)("dl", {
		className: X.figures,
		children: o.figures.map((e) => /* @__PURE__ */ (0, A.jsxs)("div", {
			className: X.pair,
			children: [/* @__PURE__ */ (0, A.jsx)("dt", { children: e.label }), /* @__PURE__ */ (0, A.jsxs)("dd", {
				className: X.value,
				children: [
					/* @__PURE__ */ (0, A.jsx)(wr, {
						variant: "link",
						className: X.figure,
						disabled: n,
						title: i("FIGURE.title", {
							exact: e.minor,
							receipt: o.id
						}),
						"aria-label": i("ASK.answer.figure.open", {
							label: e.label,
							display: e.display,
							exact: Ky(i, e),
							receipt: o.id
						}),
						onClick: (e) => r(a.runId, e.currentTarget, t),
						children: e.display
					}),
					/* @__PURE__ */ (0, A.jsx)(Mp, {
						kind: "what-if",
						className: X.label
					}),
					o.stale && /* @__PURE__ */ (0, A.jsx)(Mp, {
						kind: "stale",
						className: X.label
					})
				]
			})]
		}, e.key))
	});
}
function Yy({ entry: e, view: t, checking: n, onProof: r }) {
	let i = j(), a = e.state.status;
	return /* @__PURE__ */ (0, A.jsxs)("li", {
		className: X.job,
		children: [
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: X.jobTitle,
				children: e.job.label
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: X.state,
				children: /* @__PURE__ */ (0, A.jsx)(Sr, {
					mark: Wy[a],
					wordsKey: `RETAINED.scenario.job.${a}`,
					showWords: !0
				})
			}),
			e.state.reusedFromRevisionId !== void 0 && /* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: i("RETAINED.scenario.job.reused", { revision: e.state.reusedFromRevisionId })
			}),
			/* @__PURE__ */ (0, A.jsx)(Jy, {
				entry: e,
				view: t,
				checking: n,
				onProof: r
			})
		]
	});
}
function Xy(e, t) {
	if (!e.some((e) => e.branch.role === "baseline")) return null;
	let n = e.map((e) => ({
		column: e,
		entry: e.entries.find((t) => t.job.id === e.branch.rootJobId)
	})), r = n.filter((e) => e.entry !== void 0 && e.entry.result !== null);
	if (n.some((e) => e.entry === void 0) || r.length === 0) return null;
	let i = r.map((e) => e.entry === void 0 ? null : py(e.entry)), a = i[0];
	if (a == null || a.unit !== "money") return null;
	let o = a.currency ?? r[0]?.entry?.result?.receipt.currency;
	if (i.some((e, t) => e === null || e.unit !== "money" || (e.currency ?? r[t]?.entry?.result?.receipt.currency) !== o)) return null;
	let s = n.map(({ column: e, entry: t }) => {
		let n = t?.result ?? null;
		if (t === void 0 || n === null) return {
			id: e.branch.id,
			label: e.branch.label,
			value: {
				kind: "missing",
				missing: t?.state.status === "stale" ? "unknown" : "not-loaded-yet"
			}
		};
		let r = py(t);
		if (r === null || qy(n.receipt)) return {
			id: e.branch.id,
			label: e.branch.label,
			value: {
				kind: "missing",
				missing: "unknown"
			}
		};
		let i = n.receipt.stale ? ["what-if", "stale"] : ["what-if"], a = {
			kind: "money",
			exact: r.minor,
			display: r.display,
			receiptId: n.receipt.id,
			labels: i
		};
		return {
			id: e.branch.id,
			label: e.branch.label,
			value: a,
			emphasis: e.branch.role === "alternative"
		};
	});
	return {
		form: "columns",
		sentence: t(a.label),
		values: s
	};
}
function Zy({ view: e, historical: t }) {
	let n = j();
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: X.group,
		children: [
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: t ? n("RETAINED.scenario.historicalDetail", { head: e.headRevisionId }) : n("RETAINED.scenario.currentDetail")
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: n(e.status === "complete" ? "RETAINED.scenario.completeDetail" : "RETAINED.scenario.partialDetail")
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: n("RETAINED.scenario.noActionDetail")
			}),
			/* @__PURE__ */ (0, A.jsxs)("dl", {
				className: X.pairs,
				children: [
					/* @__PURE__ */ (0, A.jsx)(Gy, {
						name: n("RETAINED.proof.revision"),
						mono: !0,
						children: e.revision.id
					}),
					/* @__PURE__ */ (0, A.jsx)(Gy, {
						name: n("RETAINED.scenario.revisionMode"),
						children: e.revision.mode
					}),
					/* @__PURE__ */ (0, A.jsx)(Gy, {
						name: n("RETAINED.scenario.parentRevision"),
						mono: !0,
						children: e.revision.parentRevisionId ?? n("ASK.answer.notSpecified")
					}),
					/* @__PURE__ */ (0, A.jsx)(Gy, {
						name: n("RETAINED.scenario.headRevision"),
						mono: !0,
						children: e.headRevisionId
					}),
					/* @__PURE__ */ (0, A.jsx)(Gy, {
						name: n("RETAINED.scenario.revisionDigest"),
						mono: !0,
						children: e.revision.digest
					}),
					/* @__PURE__ */ (0, A.jsx)(Gy, {
						name: n("RETAINED.proof.evidence"),
						mono: !0,
						children: e.revision.evidenceId
					}),
					/* @__PURE__ */ (0, A.jsx)(Gy, {
						name: n("RETAINED.scenario.evidenceDigest"),
						mono: !0,
						children: e.revision.evidenceDigest
					})
				]
			}),
			/* @__PURE__ */ (0, A.jsx)("h3", {
				className: X.heading,
				children: n("RETAINED.scenario.comparisons")
			}),
			e.comparisons.length === 0 ? /* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: n("RETAINED.scenario.comparisonNone")
			}) : e.comparisons.map((e) => /* @__PURE__ */ (0, A.jsxs)("div", {
				className: X.group,
				children: [
					/* @__PURE__ */ (0, A.jsx)("p", {
						className: [X.text, "fig"].join(" "),
						children: n("RETAINED.scenario.comparison", {
							id: e.id,
							createdAt: e.createdAt
						})
					}),
					/* @__PURE__ */ (0, A.jsx)("dl", {
						className: X.pairs,
						children: /* @__PURE__ */ (0, A.jsx)(Gy, {
							name: n("RETAINED.scenario.comparisonDigest"),
							mono: !0,
							children: e.digest
						})
					}),
					/* @__PURE__ */ (0, A.jsx)("h4", {
						className: X.heading,
						children: n("RETAINED.scenario.limitations")
					}),
					/* @__PURE__ */ (0, A.jsx)("ul", {
						className: X.list,
						children: e.limitations.map((e, t) => /* @__PURE__ */ (0, A.jsx)("li", {
							className: X.text,
							children: e
						}, t))
					}),
					/* @__PURE__ */ (0, A.jsx)("h4", {
						className: X.heading,
						children: n("RETAINED.scenario.requiredJobs")
					}),
					/* @__PURE__ */ (0, A.jsx)("ul", {
						className: X.list,
						children: e.requiredJobs.map((e) => /* @__PURE__ */ (0, A.jsx)("li", {
							className: X.text,
							children: /* @__PURE__ */ (0, A.jsxs)("dl", {
								className: X.pairs,
								children: [
									/* @__PURE__ */ (0, A.jsx)(Gy, {
										name: n("RETAINED.proof.job"),
										mono: !0,
										children: e.jobId
									}),
									/* @__PURE__ */ (0, A.jsx)(Gy, {
										name: n("RETAINED.proof.run"),
										mono: !0,
										children: e.runId
									}),
									/* @__PURE__ */ (0, A.jsx)(Gy, {
										name: n("RETAINED.scenario.runRevision"),
										mono: !0,
										children: e.runRevisionId
									}),
									/* @__PURE__ */ (0, A.jsx)(Gy, {
										name: n("RETAINED.scenario.reusedFrom"),
										mono: !0,
										children: e.reusedFromRevisionId ?? n("ASK.answer.notSpecified")
									}),
									/* @__PURE__ */ (0, A.jsx)(Gy, {
										name: n("RETAINED.scenario.receiptId"),
										mono: !0,
										children: e.receiptId
									}),
									/* @__PURE__ */ (0, A.jsx)(Gy, {
										name: n("RETAINED.proof.receiptDigest"),
										mono: !0,
										children: e.receiptDigest
									})
								]
							})
						}, e.jobId))
					})
				]
			}, e.id)),
			/* @__PURE__ */ (0, A.jsx)("h3", {
				className: X.heading,
				children: n("RETAINED.scenario.jobsHeading")
			}),
			/* @__PURE__ */ (0, A.jsx)("ul", {
				className: X.list,
				children: e.revision.jobs.map((t) => {
					let r = e.jobs.find((e) => e.jobId === t.id);
					return /* @__PURE__ */ (0, A.jsxs)("li", {
						className: X.text,
						children: [/* @__PURE__ */ (0, A.jsxs)("dl", {
							className: X.pairs,
							children: [
								/* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.proof.jobLabel"),
									children: t.label
								}),
								/* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.proof.job"),
									mono: !0,
									children: t.id
								}),
								/* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.proof.branch"),
									mono: !0,
									children: t.branchId
								}),
								/* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("ASK.answer.calculation.operation"),
									mono: !0,
									children: t.request.operation
								}),
								/* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.scenario.requestDigest"),
									mono: !0,
									children: t.requestDigest
								}),
								/* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.scenario.inputDigest"),
									mono: !0,
									children: t.inputDigest
								}),
								/* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.scenario.dependsOn"),
									mono: !0,
									children: t.dependsOn.length === 0 ? n("MISSING.none") : t.dependsOn.join(", ")
								}),
								r !== void 0 && /* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.scenario.jobState"),
									children: n(`RETAINED.scenario.job.${r.status}`)
								}),
								r?.runId !== void 0 && /* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.proof.run"),
									mono: !0,
									children: r.runId
								}),
								r?.activeRunId !== void 0 && /* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.scenario.activeRun"),
									mono: !0,
									children: r.activeRunId
								}),
								r?.retainedRunId !== void 0 && /* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.scenario.retainedRunId"),
									mono: !0,
									children: r.retainedRunId
								}),
								r?.reusedFromRevisionId !== void 0 && /* @__PURE__ */ (0, A.jsx)(Gy, {
									name: n("RETAINED.scenario.reusedFrom"),
									mono: !0,
									children: r.reusedFromRevisionId
								})
							]
						}), r !== void 0 && r.status !== "ready" && r.retainedRunId !== void 0 && /* @__PURE__ */ (0, A.jsx)("p", {
							className: X.note,
							children: n("RETAINED.scenario.retainedRunDetail", { run: r.retainedRunId })
						})]
					}, t.id);
				})
			})
		]
	});
}
function Qy({ view: e, historical: t, checking: n, onProof: r, onProvenance: i, onRead: a }) {
	let o = j(), s = (0, _.useId)(), c = fy(e), l = c.find((e) => e.branch.role === "baseline"), u = Xy(c, (e) => o("RETAINED.scenario.chartSentence", { figure: e })), d = e.jobs.some((e) => e.status !== "ready" && e.retainedRunId !== void 0);
	return /* @__PURE__ */ (0, A.jsxs)("section", {
		className: X.scenario,
		"aria-labelledby": s,
		children: [
			/* @__PURE__ */ (0, A.jsxs)("h2", {
				id: s,
				className: X.title,
				children: [
					/* @__PURE__ */ (0, A.jsx)(Mp, { kind: "what-if" }),
					" ",
					o("RETAINED.scenario.title")
				]
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: [X.identity, "fig"].join(" "),
				children: o("RETAINED.scenario.revisionCue", {
					revision: e.revision.id,
					createdAt: e.revision.createdAt
				})
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: t ? o("RETAINED.scenario.historical", { head: e.headRevisionId }) : o("RETAINED.scenario.current")
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: o(e.status === "complete" ? "RETAINED.scenario.complete" : "RETAINED.scenario.partial")
			}),
			d && /* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: o("RETAINED.scenario.job.retainedRun")
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: o("RETAINED.scenario.noAction")
			}),
			n && /* @__PURE__ */ (0, A.jsx)("p", {
				role: "status",
				className: X.note,
				children: o("RETAINED.scenario.checking")
			}),
			u === null ? /* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: o("RETAINED.scenario.chartUnavailable")
			}) : /* @__PURE__ */ (0, A.jsx)(fm, {
				chart: u,
				onReceipt: (t) => {
					if (n) return;
					let i = e.results.filter((e) => e.receipt.id === t), a = i.length === 1 ? i[0] : void 0;
					a !== void 0 && r(a.runId, document.activeElement instanceof HTMLElement ? document.activeElement : null, e);
				},
				width: Math.max(120, c.length * 72)
			}),
			/* @__PURE__ */ (0, A.jsxs)("table", {
				className: X.table,
				children: [/* @__PURE__ */ (0, A.jsx)("thead", { children: /* @__PURE__ */ (0, A.jsx)("tr", { children: c.map((e) => /* @__PURE__ */ (0, A.jsx)("th", {
					scope: "col",
					className: X.head,
					children: /* @__PURE__ */ (0, A.jsxs)("div", {
						className: X.column,
						children: [
							/* @__PURE__ */ (0, A.jsx)("span", {
								className: X.columnLabel,
								children: e.branch.label
							}),
							/* @__PURE__ */ (0, A.jsx)("span", {
								className: X.note,
								children: o(e.branch.role === "baseline" ? "RETAINED.scenario.columnBaseline" : "RETAINED.scenario.columnAlternative")
							}),
							/* @__PURE__ */ (0, A.jsx)("span", {
								className: [X.note, "fig"].join(" "),
								children: e.branch.role === "baseline" || l === void 0 ? o("RETAINED.scenario.assumption", { bps: e.branch.priceChangeBps }) : o("RETAINED.scenario.assumptionChange", {
									before: l.branch.priceChangeBps,
									after: e.branch.priceChangeBps
								})
							})
						]
					})
				}, e.branch.id)) }) }), /* @__PURE__ */ (0, A.jsx)("tbody", { children: /* @__PURE__ */ (0, A.jsx)("tr", { children: c.map((t) => /* @__PURE__ */ (0, A.jsx)("td", {
					className: X.cell,
					children: /* @__PURE__ */ (0, A.jsx)("ul", {
						className: X.jobs,
						children: t.entries.map((t) => /* @__PURE__ */ (0, A.jsx)(Yy, {
							entry: t,
							view: e,
							checking: n,
							onProof: r
						}, t.job.id))
					})
				}, t.branch.id)) }) })]
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: X.note,
				children: o(e.comparisons.length === 0 ? "RETAINED.scenario.comparisonNone" : "RETAINED.scenario.comparisonCue")
			}),
			/* @__PURE__ */ (0, A.jsxs)("div", {
				className: X.actions,
				children: [/* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "quiet",
					disabled: n,
					onClick: (t) => i(t.currentTarget, e),
					children: o("RETAINED.scenario.provenance")
				}), /* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "link",
					onClick: a,
					children: o("RETAINED.readAgain")
				})]
			})
		]
	});
}
function $y({ state: e, selectionSupplied: t, onRead: n, onProof: r, onProvenance: i, legacy: a }) {
	let o = j(), s;
	if (!t) s = /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)("p", {
		role: "status",
		className: X.text,
		children: o("RETAINED.scenario.noDiscovery")
	}), /* @__PURE__ */ (0, A.jsx)("p", {
		className: X.note,
		children: o("RETAINED.scenario.readbackNote")
	})] });
	else if (e.kind === "ready") s = /* @__PURE__ */ (0, A.jsx)(Qy, {
		view: e.view,
		historical: e.historical,
		checking: e.checking,
		onProof: r,
		onProvenance: i,
		onRead: n
	});
	else if (e.kind === "unavailable") {
		let t = e.code === "SCENARIO_VIEW_CHANGED" ? "RETAINED.scenario.changed" : Uy(e.code) ? "RETAINED.scenario.transport" : "RETAINED.scenario.unavailable";
		s = /* @__PURE__ */ (0, A.jsx)(Vp, {
			state: {
				kind: "failed",
				code: e.code,
				what: o(t)
			},
			action: {
				label: o("RETAINED.readAgain"),
				onPress: n
			}
		});
	} else s = /* @__PURE__ */ (0, A.jsx)("p", {
		role: "status",
		className: X.text,
		children: o("RETAINED.scenario.loading")
	});
	return /* @__PURE__ */ (0, A.jsxs)("section", {
		className: X.page,
		"aria-label": o("SH-01.sub.ask.saved"),
		children: [
			/* @__PURE__ */ (0, A.jsx)(Up, {
				where: o("SH-01.place.ask"),
				title: o("SH-01.sub.ask.saved")
			}),
			s,
			a
		]
	});
}
var Z = {
	page: "_page_14jpc_3",
	group: "_group_14jpc_4",
	heading: "_heading_14jpc_11",
	text: "_text_14jpc_19",
	note: "_note_14jpc_25",
	pairs: "_pairs_14jpc_32",
	pair: "_pair_14jpc_32",
	name: "_name_14jpc_45",
	value: "_value_14jpc_50",
	list: "_list_14jpc_57",
	item: "_item_14jpc_65",
	payload: "_payload_14jpc_73",
	more: "_more_14jpc_83",
	summary: "_summary_14jpc_87",
	actions: "_actions_14jpc_98"
}, eb = 5;
function tb(e, t) {
	let n = Math.max(0, Math.ceil(e.length / eb) - 1), r = Math.min(Math.max(0, t), n) * eb, i = e.slice(r, r + eb);
	return {
		rows: i,
		from: i.length === 0 ? 0 : r + 1,
		to: r + i.length,
		total: e.length,
		last: n
	};
}
var nb = {
	proposed: "busy",
	"evaluation-blocked": "unsure",
	"review-ready": "wait",
	approved: "you",
	rejected: "off",
	deferred: "off",
	retired: "off",
	superseded: "off"
};
function rb(e) {
	let t = j();
	return e.map((e) => ({
		id: e.candidate.id,
		mark: nb[e.status],
		markWordsKey: `RETAINED.lesson.status.${e.status}`,
		what: e.candidate.title,
		note: t("RETAINED.lesson.rowStatus", {
			status: t(`RETAINED.lesson.status.${e.status}`),
			kind: t(`RETAINED.lesson.kind.${e.candidate.change.kind}`),
			target: e.candidate.change.targetId,
			count: e.candidate.evidence.length
		})
	}));
}
function ib({ state: e, onOpen: t, onPage: n }) {
	let r = j(), i = (0, _.useId)(), a = e.lessons, o = tb(a, e.page), s = rb(o.rows), c = Math.min(e.page, o.last);
	return /* @__PURE__ */ (0, A.jsxs)("section", {
		className: Z.group,
		"aria-labelledby": i,
		children: [
			/* @__PURE__ */ (0, A.jsx)("h2", {
				id: i,
				className: Z.heading,
				children: r("RETAINED.lesson.title")
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: Z.note,
				children: r("RETAINED.lesson.note")
			}),
			e.kind === "ready" && e.notice !== null && /* @__PURE__ */ (0, A.jsx)("p", {
				role: "status",
				className: Z.text,
				children: r(e.notice === "LESSON_REVIEW_CHANGED" ? "RETAINED.lesson.changed" : "RETAINED.lesson.cancelled")
			}),
			e.kind === "deciding" && /* @__PURE__ */ (0, A.jsx)("p", {
				role: "status",
				className: Z.note,
				children: r("RETAINED.lesson.deciding")
			}),
			a.length === 0 ? /* @__PURE__ */ (0, A.jsx)("p", {
				className: Z.text,
				children: r("RETAINED.lesson.empty")
			}) : /* @__PURE__ */ (0, A.jsx)(Xp, {
				rows: s,
				labelledBy: i,
				selectedId: e.selectedId ?? void 0,
				onOpen: (n, r) => t(n, r, {
					list: a,
					from: e.selectedId,
					page: c
				}),
				onReceipt: () => {}
			}),
			a.length > eb && /* @__PURE__ */ (0, A.jsxs)("div", {
				className: Z.actions,
				children: [
					/* @__PURE__ */ (0, A.jsx)("p", {
						className: Z.note,
						children: r("RETAINED.lesson.page", {
							from: o.from,
							to: o.to,
							total: o.total
						})
					}),
					/* @__PURE__ */ (0, A.jsx)(wr, {
						variant: "link",
						disabled: c === 0,
						onClick: () => n(a, c, c - 1),
						children: r("RETAINED.lesson.pageEarlier")
					}),
					/* @__PURE__ */ (0, A.jsx)(wr, {
						variant: "link",
						disabled: c >= o.last,
						onClick: () => n(a, c, c + 1),
						children: r("RETAINED.lesson.pageLater")
					})
				]
			})
		]
	});
}
function ab({ state: e, where: t, title: n, onRead: r, onOpen: i, onPage: a, legacy: o }) {
	let s = j(), c;
	return c = e.kind === "ready" || e.kind === "deciding" ? /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)(ib, {
		state: e,
		onOpen: i,
		onPage: a
	}), /* @__PURE__ */ (0, A.jsx)("div", {
		className: Z.actions,
		children: /* @__PURE__ */ (0, A.jsx)(wr, {
			variant: "link",
			onClick: r,
			children: s("RETAINED.readAgain")
		})
	})] }) : e.kind === "unavailable" ? /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)(Vp, {
		state: {
			kind: "failed",
			code: e.code,
			what: s(Uy(e.code) ? "RETAINED.lesson.transport" : "RETAINED.lesson.unavailable")
		},
		action: {
			label: s("RETAINED.readAgain"),
			onPress: r
		}
	}), e.afterDispatch && /* @__PURE__ */ (0, A.jsx)("p", {
		role: "status",
		className: Z.text,
		children: s("RETAINED.lesson.uncertain")
	})] }) : /* @__PURE__ */ (0, A.jsx)("p", {
		role: "status",
		className: Z.text,
		children: s("RETAINED.lesson.loading")
	}), /* @__PURE__ */ (0, A.jsxs)("section", {
		className: Z.page,
		"aria-label": n,
		children: [
			/* @__PURE__ */ (0, A.jsx)(Up, {
				where: t,
				title: n
			}),
			c,
			o
		]
	});
}
function Q({ name: e, mono: t = !1, children: n }) {
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: Z.pair,
		children: [/* @__PURE__ */ (0, A.jsx)("dt", {
			className: Z.name,
			children: e
		}), /* @__PURE__ */ (0, A.jsx)("dd", {
			className: [Z.value, t ? "fig" : ""].filter(Boolean).join(" "),
			children: n
		})]
	});
}
function ob({ value: e }) {
	return /* @__PURE__ */ (0, A.jsx)("pre", {
		className: Z.payload,
		children: JSON.stringify(e, null, 2)
	});
}
function sb({ actor: e }) {
	let t = j();
	return /* @__PURE__ */ (0, A.jsx)(A.Fragment, { children: t("RETAINED.lesson.actorPin", {
		member: e.memberId,
		role: t(`RETAINED.lesson.role.${e.role}`),
		enum: e.role,
		epoch: e.epoch
	}) });
}
function cb({ name: e, pin: t }) {
	let n = j();
	return /* @__PURE__ */ (0, A.jsx)(Q, {
		name: e,
		mono: !0,
		children: n("RETAINED.lesson.artifact", {
			id: t.id,
			revision: t.revision,
			digest: t.digest
		})
	});
}
function lb({ value: e }) {
	let t = j(), n = Object.entries(e);
	return n.length === 0 ? /* @__PURE__ */ (0, A.jsx)(A.Fragment, { children: t("MISSING.none") }) : /* @__PURE__ */ (0, A.jsx)("dl", {
		className: Z.pairs,
		children: n.map(([e, t]) => /* @__PURE__ */ (0, A.jsx)(Q, {
			name: e,
			mono: !0,
			children: t
		}, e))
	});
}
function ub({ name: e, summary: t }) {
	let n = j();
	return /* @__PURE__ */ (0, A.jsxs)("div", {
		className: Z.group,
		children: [
			/* @__PURE__ */ (0, A.jsx)("h4", {
				className: Z.heading,
				children: e
			}),
			/* @__PURE__ */ (0, A.jsx)("p", {
				className: Z.text,
				children: n(`RETAINED.lesson.qualification.${t.qualification}`)
			}),
			/* @__PURE__ */ (0, A.jsxs)("dl", {
				className: Z.pairs,
				children: [
					/* @__PURE__ */ (0, A.jsx)(Q, {
						name: n("RETAINED.lesson.evaluation.status"),
						children: n(`RETAINED.lesson.evaluation.status.${t.status}`)
					}),
					/* @__PURE__ */ (0, A.jsx)(Q, {
						name: n("RETAINED.lesson.authority"),
						mono: !0,
						children: t.authorityId
					}),
					/* @__PURE__ */ (0, A.jsx)(Q, {
						name: n("RETAINED.lesson.comparison"),
						mono: !0,
						children: t.comparisonId
					}),
					/* @__PURE__ */ (0, A.jsx)(Q, {
						name: n("RETAINED.lesson.completedAt"),
						mono: !0,
						children: t.completedAt
					}),
					/* @__PURE__ */ (0, A.jsx)(Q, {
						name: n("RETAINED.lesson.baselineDigest"),
						mono: !0,
						children: t.baseline.digest
					}),
					/* @__PURE__ */ (0, A.jsx)(Q, {
						name: n("RETAINED.lesson.sourceTaint"),
						children: n(t.sourceTainted ? "RETAINED.lesson.evidence.tainted" : "RETAINED.lesson.evidence.clean")
					}),
					/* @__PURE__ */ (0, A.jsx)(Q, {
						name: n("RETAINED.lesson.sources"),
						mono: !0,
						children: t.sourceIds.length === 0 ? n("MISSING.none") : t.sourceIds.join(", ")
					})
				]
			}),
			/* @__PURE__ */ (0, A.jsx)("h5", {
				className: Z.heading,
				children: n("RETAINED.lesson.metrics")
			}),
			t.metrics.length === 0 ? /* @__PURE__ */ (0, A.jsx)("p", {
				className: Z.note,
				children: n("MISSING.none")
			}) : /* @__PURE__ */ (0, A.jsx)("ul", {
				className: Z.list,
				children: t.metrics.map((e) => /* @__PURE__ */ (0, A.jsx)("li", {
					className: [Z.text, "fig"].join(" "),
					children: n("RETAINED.lesson.metric", {
						name: e.name,
						before: String(e.before),
						after: String(e.after),
						direction: n(`RETAINED.lesson.direction.${e.direction}`)
					})
				}, e.name))
			}),
			/* @__PURE__ */ (0, A.jsxs)("details", {
				className: Z.more,
				children: [/* @__PURE__ */ (0, A.jsx)("summary", {
					className: Z.summary,
					children: n("RETAINED.lesson.pins")
				}), /* @__PURE__ */ (0, A.jsxs)("dl", {
					className: Z.pairs,
					children: [
						/* @__PURE__ */ (0, A.jsx)(cb, {
							name: n("RETAINED.lesson.reference"),
							pin: t.reference
						}),
						/* @__PURE__ */ (0, A.jsx)(cb, {
							name: n("RETAINED.lesson.suite"),
							pin: t.suite
						}),
						/* @__PURE__ */ (0, A.jsx)(cb, {
							name: n("RETAINED.lesson.harness"),
							pin: t.harness
						}),
						/* @__PURE__ */ (0, A.jsx)(cb, {
							name: n("RETAINED.lesson.build"),
							pin: t.build
						}),
						/* @__PURE__ */ (0, A.jsx)(cb, {
							name: n("RETAINED.lesson.configuration"),
							pin: t.configuration
						})
					]
				})]
			})
		]
	});
}
function db({ view: e, availability: t, deciding: n, position: r, origin: i, onClose: a, onAdjacent: o, onDecide: s }) {
	let c = j(), [l, u] = (0, _.useState)(""), d = e.candidate, f = Fy(l) !== null, p = l.trim().length > 0 && !f ? c("RETAINED.lesson.reasonInvalid") : void 0, m = (r) => {
		t.ok && f && !n && e.review !== void 0 && e.evaluation !== void 0 && s({
			candidate: Ey(d),
			reviewId: e.review.id,
			reviewDigest: e.review.digest,
			evaluationDigest: e.evaluation.digest,
			decision: r
		}, l);
	}, h = t.ok ? {
		label: c("BTN.approve"),
		onPress: () => m("approve"),
		disabled: !f || n
	} : void 0, g = t.ok ? /* @__PURE__ */ (0, A.jsx)(wr, {
		variant: "quiet",
		disabled: !f || n,
		onClick: () => m("defer"),
		children: c("BTN.notNow")
	}) : void 0;
	return /* @__PURE__ */ (0, A.jsxs)(Cp, {
		kind: c("RETAINED.lesson.sheet"),
		position: r,
		title: d.title,
		origin: i,
		onClose: a,
		onAdjacent: o,
		primary: h,
		actions: g,
		children: [
			/* @__PURE__ */ (0, A.jsxs)("dl", {
				className: Z.pairs,
				children: [/* @__PURE__ */ (0, A.jsx)(Q, {
					name: c("RETAINED.lesson.statusName"),
					children: c(`RETAINED.lesson.status.${e.status}`)
				}), /* @__PURE__ */ (0, A.jsx)(Q, {
					name: c("RETAINED.lesson.kindName"),
					children: c(`RETAINED.lesson.kind.${d.change.kind}`)
				})]
			}),
			/* @__PURE__ */ (0, A.jsxs)("section", {
				className: Z.group,
				children: [/* @__PURE__ */ (0, A.jsx)("h3", {
					className: Z.heading,
					children: c("RETAINED.lesson.rationale")
				}), /* @__PURE__ */ (0, A.jsx)("p", {
					className: Z.text,
					children: d.rationale
				})]
			}),
			/* @__PURE__ */ (0, A.jsxs)("section", {
				className: Z.group,
				children: [/* @__PURE__ */ (0, A.jsx)("h3", {
					className: Z.heading,
					children: c("RETAINED.lesson.change")
				}), /* @__PURE__ */ (0, A.jsxs)("dl", {
					className: Z.pairs,
					children: [
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.target"),
							mono: !0,
							children: d.change.targetId
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("WK-02.before"),
							children: /* @__PURE__ */ (0, A.jsx)(ob, { value: d.change.before })
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("WK-02.after"),
							children: /* @__PURE__ */ (0, A.jsx)(ob, { value: d.change.after })
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.targetValue"),
							children: /* @__PURE__ */ (0, A.jsx)(ob, { value: d.target.value })
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.targetPin"),
							mono: !0,
							children: c("RETAINED.lesson.artifact", {
								id: d.target.id,
								revision: d.target.revision,
								digest: d.target.digest
							})
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.owner"),
							children: /* @__PURE__ */ (0, A.jsx)(sb, { actor: d.target.owner })
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, A.jsxs)("section", {
				className: Z.group,
				children: [/* @__PURE__ */ (0, A.jsx)("h3", {
					className: Z.heading,
					children: c("RETAINED.lesson.evidence")
				}), d.evidence.length === 0 ? /* @__PURE__ */ (0, A.jsx)("p", {
					className: Z.note,
					children: c("MISSING.none")
				}) : /* @__PURE__ */ (0, A.jsx)("ul", {
					className: Z.list,
					children: d.evidence.map((e) => /* @__PURE__ */ (0, A.jsxs)("li", {
						className: Z.item,
						children: [/* @__PURE__ */ (0, A.jsxs)("dl", {
							className: Z.pairs,
							children: [
								/* @__PURE__ */ (0, A.jsx)(Q, {
									name: c(`RETAINED.lesson.evidence.kind.${e.pin.kind}`),
									mono: !0,
									children: c("RETAINED.lesson.artifact", {
										id: e.pin.id,
										revision: e.pin.revision,
										digest: e.pin.digest
									})
								}),
								/* @__PURE__ */ (0, A.jsx)(Q, {
									name: c("RETAINED.lesson.evidence.standing"),
									children: c(e.available ? "RETAINED.lesson.evidence.available" : "RETAINED.lesson.evidence.unavailable")
								}),
								/* @__PURE__ */ (0, A.jsx)(Q, {
									name: c("RETAINED.lesson.sourceTaint"),
									children: c(e.sourceTainted ? "RETAINED.lesson.evidence.tainted" : "RETAINED.lesson.evidence.clean")
								}),
								/* @__PURE__ */ (0, A.jsx)(Q, {
									name: c("RETAINED.lesson.sources"),
									mono: !0,
									children: e.pin.sourceIds.join(", ")
								}),
								/* @__PURE__ */ (0, A.jsx)(Q, {
									name: c("RETAINED.lesson.branches"),
									mono: !0,
									children: e.pin.branchIds.join(", ")
								}),
								/* @__PURE__ */ (0, A.jsx)(Q, {
									name: c("RETAINED.lesson.markings"),
									children: e.sourceMarkings.length === 0 ? c("MISSING.none") : /* @__PURE__ */ (0, A.jsx)("ul", {
										className: Z.list,
										children: e.sourceMarkings.map((e, t) => /* @__PURE__ */ (0, A.jsx)("li", {
											className: [Z.text, "fig"].join(" "),
											children: c("RETAINED.lesson.marking", {
												source: e.sourceId,
												marking: e.marking
											})
										}, t))
									})
								})
							]
						}), /* @__PURE__ */ (0, A.jsx)("p", {
							className: Z.text,
							children: e.summary
						})]
					}, `${e.pin.kind}:${e.pin.id}:${e.pin.revision}`))
				})]
			}),
			/* @__PURE__ */ (0, A.jsxs)("section", {
				className: Z.group,
				children: [
					/* @__PURE__ */ (0, A.jsx)("h3", {
						className: Z.heading,
						children: c("RETAINED.lesson.scope")
					}),
					/* @__PURE__ */ (0, A.jsxs)("dl", {
						className: Z.pairs,
						children: [
							/* @__PURE__ */ (0, A.jsx)(Q, {
								name: c("RETAINED.lesson.member"),
								mono: !0,
								children: d.applicability.memberId
							}),
							/* @__PURE__ */ (0, A.jsx)(Q, {
								name: c("RETAINED.lesson.branches"),
								mono: !0,
								children: d.applicability.branchIds.join(", ")
							}),
							/* @__PURE__ */ (0, A.jsx)(Q, {
								name: c("RETAINED.lesson.sources"),
								mono: !0,
								children: d.applicability.sourceIds.join(", ")
							}),
							/* @__PURE__ */ (0, A.jsx)(Q, {
								name: c("RETAINED.lesson.conditions"),
								children: /* @__PURE__ */ (0, A.jsx)(lb, { value: d.applicability.conditions })
							})
						]
					}),
					/* @__PURE__ */ (0, A.jsx)("h4", {
						className: Z.heading,
						children: c("RETAINED.lesson.counterexamples")
					}),
					/* @__PURE__ */ (0, A.jsx)("ul", {
						className: Z.list,
						children: d.counterexamples.map((e, t) => /* @__PURE__ */ (0, A.jsxs)("li", {
							className: Z.item,
							children: [/* @__PURE__ */ (0, A.jsx)(lb, { value: e.conditions }), /* @__PURE__ */ (0, A.jsx)("p", {
								className: Z.text,
								children: e.reason
							})]
						}, t))
					})
				]
			}),
			/* @__PURE__ */ (0, A.jsxs)("section", {
				className: Z.group,
				children: [/* @__PURE__ */ (0, A.jsx)("h3", {
					className: Z.heading,
					children: c("RETAINED.lesson.evaluation")
				}), e.evaluation === void 0 ? /* @__PURE__ */ (0, A.jsx)("p", {
					className: Z.text,
					children: c("RETAINED.lesson.evaluation.none")
				}) : /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [
					/* @__PURE__ */ (0, A.jsx)(ub, {
						name: c("RETAINED.lesson.evaluation.open"),
						summary: e.evaluation.open
					}),
					/* @__PURE__ */ (0, A.jsx)(ub, {
						name: c("RETAINED.lesson.evaluation.hidden"),
						summary: e.evaluation.hidden
					}),
					/* @__PURE__ */ (0, A.jsx)("dl", {
						className: Z.pairs,
						children: /* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.evaluationDigest"),
							mono: !0,
							children: e.evaluation.digest
						})
					})
				] })]
			}),
			/* @__PURE__ */ (0, A.jsxs)("section", {
				className: Z.group,
				children: [/* @__PURE__ */ (0, A.jsx)("h3", {
					className: Z.heading,
					children: c("RETAINED.lesson.review")
				}), e.review === void 0 ? /* @__PURE__ */ (0, A.jsx)("p", {
					className: Z.text,
					children: c("RETAINED.lesson.review.none")
				}) : /* @__PURE__ */ (0, A.jsxs)("dl", {
					className: Z.pairs,
					children: [
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.reviewId"),
							mono: !0,
							children: e.review.id
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.reviewer"),
							children: /* @__PURE__ */ (0, A.jsx)(sb, { actor: e.review.reviewer })
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.reviewedAt"),
							mono: !0,
							children: e.review.at
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.evaluationDigest"),
							mono: !0,
							children: e.review.evaluationDigest
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.digest"),
							mono: !0,
							children: e.review.digest
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, A.jsxs)("details", {
				className: Z.more,
				children: [/* @__PURE__ */ (0, A.jsx)("summary", {
					className: Z.summary,
					children: c("RETAINED.lesson.identity")
				}), /* @__PURE__ */ (0, A.jsxs)("dl", {
					className: Z.pairs,
					children: [
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.candidate"),
							mono: !0,
							children: c("RETAINED.lesson.candidatePin", {
								id: d.id,
								revision: d.revision
							})
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.digest"),
							mono: !0,
							children: d.digest
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.workspace"),
							mono: !0,
							children: d.workspaceId
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.owner"),
							children: /* @__PURE__ */ (0, A.jsx)(sb, { actor: d.owner })
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.proposedBy"),
							children: /* @__PURE__ */ (0, A.jsx)(sb, { actor: d.proposedBy })
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.proposedAt"),
							mono: !0,
							children: d.proposedAt
						}),
						/* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.episodes"),
							mono: !0,
							children: d.episodeIds.length === 0 ? c("MISSING.none") : d.episodeIds.join(", ")
						}),
						d.supersedes !== void 0 && /* @__PURE__ */ (0, A.jsx)(Q, {
							name: c("RETAINED.lesson.supersedes"),
							mono: !0,
							children: c("RETAINED.lesson.candidatePin", {
								id: d.supersedes.id,
								revision: d.supersedes.revision
							})
						})
					]
				})]
			}),
			/* @__PURE__ */ (0, A.jsx)("section", {
				className: Z.group,
				children: t.ok ? /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [
					/* @__PURE__ */ (0, A.jsx)(Pm, {
						label: c("RETAINED.lesson.reason"),
						value: l,
						onChange: (e) => u(e.currentTarget.value),
						disabled: n,
						maxLength: Py,
						problem: p,
						autoComplete: "off"
					}),
					!f && p === void 0 && /* @__PURE__ */ (0, A.jsx)("p", {
						className: Z.note,
						children: c("RETAINED.lesson.reasonRequired")
					}),
					/* @__PURE__ */ (0, A.jsx)("p", {
						className: Z.note,
						children: c("RETAINED.lesson.decisionNote")
					}),
					n && /* @__PURE__ */ (0, A.jsx)("p", {
						role: "status",
						className: Z.note,
						children: c("RETAINED.lesson.deciding")
					})
				] }) : /* @__PURE__ */ (0, A.jsx)("p", {
					className: Z.text,
					children: c(`RETAINED.lesson.block.${t.block}`)
				})
			})
		]
	});
}
//#endregion
//#region app/ui/src/screens/retained/RetainedPlace.tsx
function fb(e) {
	return e.place === "ask" && e.sub === "saved" ? "scenario" : e.place === "reports" && e.sub === "weekahead" || e.place === "work" && e.sub === "approvals" ? "lessons" : null;
}
function pb({ address: e, retained: t, scenarioSelection: n, live: r, onProof: i, onProvenance: a, onOpenLesson: o, legacy: s }) {
	let c = j(), l = (0, _.useSyncExternalStore)(t.subscribe, t.snapshot, t.snapshot), u = fb(e), d = e.sheet === void 0, f = n != null, p = l.scenario.kind === "idle", m = l.lessons.kind === "idle";
	if ((0, _.useEffect)(() => {
		u === "scenario" && d && f && p && r(e) && t.openScenario(n, () => r(e));
	}, [
		u,
		d,
		f,
		p,
		t,
		n,
		r,
		e
	]), (0, _.useEffect)(() => {
		u === "lessons" && d && m && r(e) && t.readLessons(() => r(e));
	}, [
		u,
		d,
		m,
		t,
		r,
		e
	]), u === "scenario") return /* @__PURE__ */ (0, A.jsx)($y, {
		state: l.scenario,
		selectionSupplied: f,
		onRead: () => {
			f && r(e) && t.openScenario(n, () => r(e));
		},
		onProof: i,
		onProvenance: a,
		legacy: s
	});
	if (u === "lessons") {
		let n = e.place === "work";
		return /* @__PURE__ */ (0, A.jsx)(ab, {
			state: l.lessons,
			where: c(n ? "SH-01.place.work" : "SH-01.place.reports"),
			title: c(n ? "SH-01.sub.work.approvals" : "SH-01.sub.reports.weekahead"),
			onRead: () => {
				r(e) && t.readLessons(() => r(e));
			},
			onOpen: o,
			onPage: (n, i, a) => {
				r(e) && t.pageLessons(n, i, a);
			},
			legacy: s
		});
	}
	return null;
}
//#endregion
//#region app/ui/src/host/text.ts
var mb = {
	legacy: "Open the previous interface",
	refresh: "Read again",
	loading: "Reading your workspace.",
	unavailable: "This workspace is unavailable. Open the previous interface to continue.",
	locked: "Private workspace data is hidden. Open the previous interface to unlock.",
	code: "Code {code}.",
	memberRole: "{name} · {role}",
	roleOwner: "owner",
	roleCofounder: "cofounder",
	roleAccountant: "accountant",
	roleViewer: "viewer",
	sourcesReady: "Available figures have checked receipts.",
	sourcesMissing: "Sources are not loaded yet.",
	routeMissing: "Choose an AI route in Trust, Models.",
	routeSelected: "Chosen AI route: {label}. Access is not verified.",
	third: "Other journeys are available in the previous interface.",
	routesTitle: "Choose an AI route",
	routesNote: "Choose a configured route yourself. Choosing one sends nothing. A question needs a separate review and consent.",
	routesUnverified: "Installation, sign-in and model access have not been verified here.",
	routesEmpty: "No configured AI routes are available.",
	routeLabel: "Configured route",
	routePlaceholder: "Choose a route",
	routeDescription: "{label} · {kind} · {model}",
	routeDisabled: "{label} · disabled",
	routeClear: "Clear the chosen route",
	viewerNoAsk: "Your viewer role can read evidence. Sending an AI request is unavailable for this role.",
	aboutTitle: "About this interface",
	helpTitle: "Keyboard shortcuts",
	helpAsk: "Go to the ask line.",
	helpPlaces: "Go to a place.",
	helpClose: "Close the sheet and return to its starting control.",
	helpRegions: "Move between navigation, page, sheet and ask line.",
	helpList: "Show this list.",
	helpSendGuard: "Ctrl Enter never sends an AI request.",
	helpUnavailable: "Voice, adjacent sheet items, the word list and offline availability are not provided here.",
	about: "Today and reviewed Ask are available here. Use the previous interface for other existing journeys.",
	receipt: "Receipt",
	receiptLoading: "Reading this receipt with your current workspace access.",
	receiptFailed: "This receipt is unavailable.",
	receiptSubset: "This view shows the checked receipt fields available here. Additional receipt details are unavailable in this interface.",
	receiptUnknown: "This receipt does not establish a known figure from counted evidence.",
	figures: "Figures",
	scope: "Scope",
	receiptId: "Receipt identity",
	operation: "Operation",
	createdAt: "Created at",
	asOf: "As of",
	period: "Period",
	comparePeriod: "Comparison period",
	branch: "Branch",
	currency: "Currency",
	requestedSources: "Requested source selection",
	countedSources: "Sources of counted rows",
	selectionAbsent: "No explicit source selection was retained.",
	selectionEmpty: "An explicit empty source selection was retained.",
	coverage: "Coverage",
	completeness: "Completeness",
	selectedRows: "Selected rows",
	countedRows: "Counted rows",
	excludedRows: "Excluded rows",
	unresolvedConflicts: "Unresolved conflicts",
	imports: "Imports",
	gaps: "Coverage gaps",
	explanation: "Explanation",
	stale: "This receipt is stale.",
	fresh: "This receipt is not marked stale.",
	hashes: "Definitions and dictionary",
	dictionaryHash: "Dictionary hash",
	definitionHash: "Definition hash",
	ontologyVersion: "Ontology version",
	ledger: "Rows and exclusions",
	assumptions: "Assumptions",
	exactFields: "All retained receipt fields",
	exactMoney: "Exact value: {minor} minor currency units. Currency: {currency}.",
	exactPoints: "Exact value: {minor} basis points.",
	dateRange: "{from} to {to}",
	none: "None supplied.",
	reference: "Evidence reference",
	referenceUnavailable: "This type of evidence cannot be opened in this interface. It has not been read as a calculation receipt.",
	referenceIdentity: "Reference: {id}."
}, hb = {
	helpTitle: "कीबोर्ड शॉर्टकट",
	helpAsk: "सवाल की पंक्ति पर जाएँ।",
	helpPlaces: "किसी जगह पर जाएँ।",
	helpClose: "शीट बंद करें और उसे खोलने वाले नियंत्रण पर लौटें।",
	helpRegions: "नेविगेशन, पन्ने, शीट और सवाल की पंक्ति के बीच जाएँ।",
	helpList: "यह सूची दिखाएँ।",
	helpSendGuard: "Ctrl Enter से AI अनुरोध नहीं भेजा जाता।",
	helpUnavailable: "आवाज़, शीट के अगले और पिछले आइटम, शब्द सूची और ऑफ़लाइन उपलब्धता यहाँ नहीं दी गई है।",
	legacy: "पिछला इंटरफ़ेस खोलें",
	refresh: "फिर से पढ़ें",
	loading: "आपका कार्यक्षेत्र पढ़ा जा रहा है।",
	unavailable: "यह कार्यक्षेत्र उपलब्ध नहीं है। आगे बढ़ने के लिए पिछला इंटरफ़ेस खोलें।",
	locked: "कार्यक्षेत्र का निजी डेटा छिपा दिया गया है। खोलने के लिए पिछला इंटरफ़ेस इस्तेमाल करें।",
	code: "कोड {code}।",
	memberRole: "{name} · {role}",
	roleOwner: "मालिक",
	roleCofounder: "सह-संस्थापक",
	roleAccountant: "लेखाकार",
	roleViewer: "दर्शक",
	sourcesReady: "उपलब्ध आँकड़ों की रसीदें जाँची गई हैं।",
	sourcesMissing: "स्रोत अभी लोड नहीं हुए हैं।",
	routeMissing: "भरोसा, मॉडल में AI रूट चुनें।",
	routeSelected: "चुना हुआ AI रूट: {label}। पहुँच की पुष्टि नहीं हुई है।",
	third: "बाकी काम पिछले इंटरफ़ेस में उपलब्ध हैं।",
	routesTitle: "AI रूट चुनें",
	routesNote: "कॉन्फ़िगर किया गया रूट स्वयं चुनें। चुनने से कुछ नहीं भेजा जाता। प्रश्न भेजने के लिए अलग समीक्षा और सहमति चाहिए।",
	routesUnverified: "यहाँ इंस्टॉलेशन, साइन-इन और मॉडल की पहुँच की पुष्टि नहीं हुई है।",
	routesEmpty: "कोई कॉन्फ़िगर किया गया AI रूट उपलब्ध नहीं है।",
	routeLabel: "कॉन्फ़िगर किया गया रूट",
	routePlaceholder: "रूट चुनें",
	routeDescription: "{label} · {kind} · {model}",
	routeDisabled: "{label} · बंद",
	routeClear: "चुना हुआ रूट हटाएँ",
	viewerNoAsk: "दर्शक की भूमिका में आप साक्ष्य पढ़ सकते हैं। इस भूमिका से AI अनुरोध भेजना उपलब्ध नहीं है।",
	aboutTitle: "इस इंटरफ़ेस के बारे में",
	about: "यहाँ आज और समीक्षा के बाद पूछें उपलब्ध हैं। बाकी मौजूदा कामों के लिए पिछला इंटरफ़ेस इस्तेमाल करें।",
	receipt: "रसीद",
	receiptLoading: "आपकी मौजूदा कार्यक्षेत्र पहुँच के साथ यह रसीद पढ़ी जा रही है।",
	receiptFailed: "यह रसीद उपलब्ध नहीं है।",
	receiptSubset: "इस दृश्य में रसीद के उपलब्ध और जाँचे गए फ़ील्ड दिखते हैं। रसीद की अतिरिक्त जानकारी इस इंटरफ़ेस में उपलब्ध नहीं है।",
	receiptUnknown: "गिने गए साक्ष्य से यह रसीद कोई ज्ञात आँकड़ा स्थापित नहीं करती।",
	figures: "आँकड़े",
	scope: "दायरा",
	receiptId: "रसीद की पहचान",
	operation: "गणना",
	createdAt: "बनाने का समय",
	asOf: "स्थिति का समय",
	period: "अवधि",
	comparePeriod: "तुलना की अवधि",
	branch: "शाखा",
	currency: "मुद्रा",
	requestedSources: "अनुरोधित स्रोत चयन",
	countedSources: "गिनी गई पंक्तियों के स्रोत",
	selectionAbsent: "कोई स्पष्ट स्रोत चयन दर्ज नहीं है।",
	selectionEmpty: "स्पष्ट रूप से खाली स्रोत चयन दर्ज है।",
	coverage: "कवरेज",
	completeness: "पूर्णता",
	selectedRows: "चुनी गई पंक्तियाँ",
	countedRows: "गिनी गई पंक्तियाँ",
	excludedRows: "बाहर रखी गई पंक्तियाँ",
	unresolvedConflicts: "अनसुलझे मतभेद",
	imports: "आयात",
	gaps: "कवरेज में कमी",
	explanation: "स्पष्टीकरण",
	stale: "यह रसीद पुरानी है।",
	fresh: "इस रसीद पर पुरानी होने का चिह्न नहीं है।",
	hashes: "परिभाषाएँ और शब्दकोश",
	dictionaryHash: "शब्दकोश हैश",
	definitionHash: "परिभाषा हैश",
	ontologyVersion: "ऑन्टोलॉजी संस्करण",
	ledger: "पंक्तियाँ और बाहर रखी गई पंक्तियाँ",
	assumptions: "मान्यताएँ",
	exactFields: "रसीद के सभी दर्ज फ़ील्ड",
	exactMoney: "सटीक मान: {minor} मुद्रा की छोटी इकाइयाँ। मुद्रा: {currency}।",
	exactPoints: "सटीक मान: {minor} आधार अंक।",
	dateRange: "{from} से {to}",
	none: "कुछ नहीं दिया गया।",
	reference: "साक्ष्य का संदर्भ",
	referenceUnavailable: "इस प्रकार का साक्ष्य इस इंटरफ़ेस में नहीं खोला जा सकता। इसे गणना की रसीद की तरह नहीं पढ़ा गया है।",
	referenceIdentity: "संदर्भ: {id}।"
};
function $(e, t, n = {}) {
	return (e === "hi" ? hb[t] : mb[t]).replace(/\{([A-Za-z]+)\}/g, (e, t) => n[t] ?? e);
}
function gb(e) {
	let t = e === "hi" ? Mn : jn;
	return {
		absent: t["MISSING.absent"],
		null: t["MISSING.null"],
		unknown: t["MISSING.unknown"],
		withheld: t["MISSING.withheld"],
		"not-applicable": t["MISSING.not-applicable"],
		"not-loaded-yet": t["MISSING.not-loaded-yet"],
		"not-counted": t["MISSING.not-counted"]
	};
}
//#endregion
//#region app/ui/src/bridge/conversation-host.ts
var _b = Object.freeze({ ok: !0 }), vb = (e) => Object.freeze({
	ok: !1,
	code: e
});
function yb(e) {
	if (typeof e == "object" && e) {
		for (let t of Object.values(e)) yb(t);
		Object.freeze(e);
	}
}
function bb(e, t) {
	if (e === t) return !0;
	if (e === null || t === null || typeof e != "object" || typeof t != "object") return !1;
	if (Array.isArray(e)) return Array.isArray(t) && e.length === t.length && e.every((e, n) => bb(e, t[n]));
	if (Array.isArray(t)) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => bb(Object.getOwnPropertyDescriptor(e, n)?.value, Object.getOwnPropertyDescriptor(t, n)?.value));
}
function xb(e) {
	if (e instanceof $m) return "INVALID_REPLY";
	let t;
	try {
		t = e && typeof e == "object" ? Object.getOwnPropertyDescriptor(e, "code") : void 0;
	} catch {
		return "REQUEST_FAILED";
	}
	let n = t && Object.hasOwn(t, "value") ? t.value : void 0;
	return n === "VAULT_LOCKED" ? "VAULT_LOCKED" : n === "UNAUTHENTICATED" || n === "INVALID_SESSION" || n === "authentication_required" ? "UNAUTHENTICATED" : typeof n == "string" ? [
		"ACCESS_DENIED",
		"ACCESS_REVOKED",
		"SOURCE_REVOKED",
		"ROUTE_REVOKED",
		"FORBIDDEN",
		"BRANCH_FORBIDDEN",
		"RECEIPT_FORBIDDEN",
		"authority_denied"
	].includes(n) ? "ACCESS_DENIED" : n === "OUTBOUND_APPROVAL_REQUIRED" ? "CONSENT_REQUIRED" : n === "CONVERSATION_CONTINUATION_RESOLVED" ? "CONTINUATION_RESOLVED" : n === "CONVERSATION_CONTINUATION_LIMIT" ? "CONTINUATION_LIMIT" : [
		"PREVIEW_STALE",
		"PAYLOAD_CHANGED",
		"PREVIEW_REQUEST_CHANGED",
		"SYNTHESIS_STALE",
		"CONVERSATION_CONTINUATION_STALE",
		"MODEL_RECEIPT_EXPIRED",
		"CALCULATION_STALE"
	].includes(n) ? "STALE_EVIDENCE" : [
		"CONVERSATION_NOT_FOUND",
		"CONVERSATION_CONTINUATION_UNAVAILABLE",
		"RECEIPT_NOT_FOUND",
		"MODEL_RECEIPT_NOT_FOUND",
		"SYNTHESIS_UNAVAILABLE",
		"EVIDENCE_UNAVAILABLE",
		"not_found"
	].includes(n) ? "EVIDENCE_UNAVAILABLE" : "REQUEST_FAILED" : "REQUEST_FAILED";
}
function Sb(e) {
	if (!e || typeof e != "object") return null;
	let t = Object.getOwnPropertyDescriptors(e), n = (e) => {
		let n = t[e];
		return n && Object.hasOwn(n, "value") ? n.value : void 0;
	}, r = n("consent"), i = n("previewId"), a = n("digest");
	return typeof r == "boolean" && typeof i == "string" && typeof a == "string" ? {
		consent: r,
		previewId: i,
		digest: a
	} : null;
}
function Cb(e, t = {}) {
	let n = Symbol(), r = Object.freeze({ kind: "idle" }), i = null, a = null, o = /* @__PURE__ */ new Set(), s = t.now ?? Date.now, c = (e) => {
		yb(e), r = e;
		for (let e of o) try {
			e();
		} catch {}
	}, l = (e, t = !1) => {
		let r = Symbol();
		return n = r, a = null, t || (i = null), c({
			kind: "busy",
			operation: e
		}), r;
	}, u = (e) => n === e, d = (e, t) => {
		if (!u(e)) return vb("READ_INVALIDATED");
		let r = xb(t);
		return u(e) ? (n = Symbol(), a = null, i = null, c({
			kind: "unavailable",
			code: r
		}), vb(r)) : vb("READ_INVALIDATED");
	}, f = () => vb("READ_INVALIDATED"), p = async (t, n, r) => {
		if (!u(n)) return f();
		let a = "id" in t ? t.id : t.modelReceiptId;
		if (c({
			kind: "busy",
			operation: "readback"
		}), !u(n)) return f();
		let o = await e.request("conversation.get", og(a));
		if (!u(n)) return f();
		let s = Ug(o, a);
		if (s.question !== r) throw new $m("conversation.readback.question");
		if (!bb(s.answer, t)) throw new $m("conversation.readback.answer");
		return u(n) ? (i = null, c({
			kind: "answer",
			saved: s
		}), u(n) ? _b : f()) : f();
	};
	return Object.freeze({
		snapshot: () => r,
		subscribe(e) {
			return o.add(e), () => {
				o.delete(e);
			};
		},
		async preview(t) {
			let n = i, r = l("preview", !0);
			try {
				if (!u(r)) return f();
				let o = sg(t);
				if (o.continuationId !== void 0) throw new $m("conversation.request.continuationId");
				let s = sg(n ? {
					...o,
					continuationId: n.turnId
				} : o);
				if (yb(s), !u(r)) return f();
				let l = await e.request("models.preview", s);
				if (!u(r)) return f();
				let d = await kg(l, s);
				if (!u(r)) return f();
				if (d.purpose !== "conversation") throw new $m("conversation.preview.purpose");
				return i = d.continuation ?? null, a = {
					stage: "planning",
					request: s,
					preview: d
				}, c({
					kind: "review",
					...a
				}), u(r) ? _b : f();
			} catch (e) {
				return d(r, e);
			}
		},
		async open(t) {
			let n = l("readback");
			try {
				if (!u(n)) return f();
				let r = await e.request("conversation.get", og(t));
				if (!u(n)) return f();
				let i = Ug(r, t);
				return u(n) ? (c({
					kind: "answer",
					saved: i
				}), u(n) ? _b : f()) : f();
			} catch (e) {
				return d(n, e);
			}
		},
		async selectContinuation(t) {
			let n = l("continuation");
			try {
				if (!u(n)) return f();
				let r = await e.request("conversation.continuation", og(t));
				if (!u(n)) return f();
				let a = await dg(r, t);
				return u(n) ? (i = a, c({
					kind: "continuation",
					value: a
				}), u(n) ? _b : f()) : f();
			} catch (e) {
				return d(n, e);
			}
		},
		async previewFinalWriting() {
			if (r.kind !== "answer" || r.saved.kind !== "grounded-conversation") return vb("NO_TOOL_TURN");
			let t = r.saved.id, n = l("synthesis-preview");
			try {
				if (!u(n)) return f();
				let r = await e.request("conversation.synthesis.preview", Pg(t));
				if (!u(n)) return f();
				let i = await kg(r, { id: t });
				if (!u(n)) return f();
				if (i.purpose !== "conversation-synthesis") throw new $m("conversation.synthesis.preview.purpose");
				return a = {
					stage: "final-writing",
					toolTurnId: t,
					preview: i
				}, c({
					kind: "review",
					...a
				}), u(n) ? _b : f();
			} catch (e) {
				return d(n, e);
			}
		},
		async sendReviewed(t) {
			let o = n, m = a, h;
			try {
				h = Sb(t);
			} catch {
				return vb("CONSENT_REQUIRED");
			}
			if (!u(o) || a !== m) return f();
			if (!h || h.consent !== !0) return vb("CONSENT_REQUIRED");
			if (r.kind !== "review" || !m || h.previewId !== m.preview.id || h.digest !== m.preview.digest) return vb("REVIEW_CHANGED");
			let g = l("approval", !0);
			try {
				if (!u(g)) return f();
				let t = await e.request("models.approve", Mg(m.preview));
				if (!u(g)) return f();
				let r = Ag(t, m.preview), o = s();
				if (!u(g)) return f();
				if (!Number.isFinite(o) || Date.parse(r.expiresAt) <= o) return n = Symbol(), a = null, i = null, c({
					kind: "unavailable",
					code: "APPROVAL_EXPIRED"
				}), vb("APPROVAL_EXPIRED");
				let l;
				if (m.stage === "planning") {
					if (c({
						kind: "busy",
						operation: "ask"
					}), !u(g)) return f();
					l = await e.request("conversation.ask", Ng(m.request, m.preview, r));
				} else {
					if (c({
						kind: "busy",
						operation: "synthesis-run"
					}), !u(g)) return f();
					l = await e.request("conversation.synthesis.run", Fg(m.toolTurnId, m.preview, r));
				}
				if (!u(g)) return f();
				let d = m.stage === "planning" ? {
					modelReceiptId: m.preview.id,
					preview: m.preview
				} : {
					toolTurnId: m.toolTurnId,
					synthesisModelReceiptId: m.preview.id,
					inputDigest: m.preview.synthesisInputDigest,
					preview: m.preview
				}, h = await Hg(l, d);
				return u(g) ? await p(h, g, m.stage === "planning" ? m.request.question : m.preview.naturalQuestion) : f();
			} catch (e) {
				return d(g, e);
			}
		},
		editQuestion() {
			n = Symbol(), a = null, c(i ? {
				kind: "continuation",
				value: i
			} : { kind: "idle" });
		},
		cancel() {
			n = Symbol(), a = null, i = null, c({ kind: "idle" });
		},
		invalidate(e = "READ_INVALIDATED") {
			n = Symbol(), a = null, i = null, c({
				kind: "unavailable",
				code: e
			});
		}
	});
}
//#endregion
//#region app/ui/src/host/contracts.ts
function wb(e) {
	throw new $m(e);
}
function Tb(e, t) {
	(typeof e != "object" || !e || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype || Object.getOwnPropertySymbols(e).length) && wb(t);
	for (let n of Object.values(Object.getOwnPropertyDescriptors(e))) (!n.enumerable || !Object.hasOwn(n, "value") || n.value === void 0) && wb(t);
	return e;
}
function Eb(e, t, n) {
	let r = Tb(e, n);
	return (Object.keys(r).length !== t.length || t.some((e) => !Object.hasOwn(r, e))) && wb(n), r;
}
function Db(e, t, n = 200) {
	return (typeof e != "string" || !e.trim() || e.length > n || /[\u0000-\u001f]/.test(e)) && wb(t), e;
}
function Ob(e, t) {
	let n = Db(e, t);
	return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(n) || wb(t), n;
}
function kb(e, t, n) {
	(!Array.isArray(e) || Object.getPrototypeOf(e) !== Array.prototype || e.length > n || Object.getOwnPropertySymbols(e).length) && wb(t);
	let r = Object.getOwnPropertyDescriptors(e);
	Object.keys(r).length !== e.length + 1 && wb(t);
	for (let n = 0; n < e.length; n++) (!r[String(n)]?.enumerable || !Object.hasOwn(r[String(n)], "value")) && wb(t);
	return e;
}
function Ab(e) {
	let t = Eb(e, [
		"workspace",
		"member",
		"contextKey"
	], "ui.context"), n = Eb(t.workspace, [
		"id",
		"name",
		"demo"
	], "ui.context.workspace"), r = Eb(t.member, [
		"id",
		"name",
		"role",
		"epoch",
		"branches"
	], "ui.context.member");
	typeof n.demo != "boolean" && wb("ui.context.workspace.demo"), (typeof r.role != "string" || ![
		"owner",
		"cofounder",
		"accountant",
		"viewer"
	].includes(r.role)) && wb("ui.context.member.role"), (!Number.isSafeInteger(r.epoch) || r.epoch < 1) && wb("ui.context.member.epoch");
	let i = kb(r.branches, "ui.context.member.branches", 1e3).map((e, t) => Db(e, `ui.context.member.branches[${t}]`));
	return new Set(i).size !== i.length && wb("ui.context.member.branches"), (typeof t.contextKey != "string" || !/^[a-f0-9]{64}$/.test(t.contextKey)) && wb("ui.context.contextKey"), Object.freeze({
		workspace: Object.freeze({
			id: Ob(n.id, "ui.context.workspace.id"),
			name: Db(n.name, "ui.context.workspace.name", 100),
			demo: n.demo
		}),
		member: Object.freeze({
			id: Ob(r.id, "ui.context.member.id"),
			name: Db(r.name, "ui.context.member.name", 200),
			role: r.role,
			epoch: r.epoch,
			branches: Object.freeze(i)
		}),
		contextKey: t.contextKey
	});
}
function jb(e) {
	let t = kb(e, "models.list", 100).map((e, t) => {
		let n = `models.list[${t}]`, r = Tb(e, n);
		(typeof r.enabled != "boolean" || r.installationVerified !== !1) && wb(n);
		let i = Db(r.kind, `${n}.kind`);
		[
			"codex-cli",
			"claude-cli",
			"openai-responses",
			"openai-compatible",
			"ollama",
			"managed"
		].includes(i) || wb(`${n}.kind`);
		let a = Db(r.model, `${n}.model`, 128);
		return Object.freeze({
			id: Ob(r.id, `${n}.id`),
			label: Object.hasOwn(r, "label") ? Db(r.label, `${n}.label`, 200) : a,
			kind: i,
			model: a,
			enabled: r.enabled,
			installationVerified: !1
		});
	});
	return new Set(t.map((e) => e.id)).size !== t.length && wb("models.list"), Object.freeze(t);
}
//#endregion
//#region app/ui/src/host/retained-controller.ts
var Mb = Object.freeze({ ok: !0 }), Nb = (e) => Object.freeze({
	ok: !1,
	code: e
}), Pb = Object.freeze({
	scenario: Object.freeze({ kind: "idle" }),
	lessons: Object.freeze({ kind: "idle" })
});
function Fb(e, t) {
	let n = Pb, r = Symbol(), i = Symbol(), a = Symbol(), o = !1, s = /* @__PURE__ */ new Set(), c = (e) => {
		n = Object.freeze({
			...n,
			...e
		});
		for (let e of s) try {
			e();
		} catch {}
	}, l = (e, t, n) => r === e && n() === t, u = (e, t) => l(e, t, () => i), d = (e, t) => l(e, t, () => a), f = (e) => {
		try {
			return e === void 0 || e() === !0;
		} catch {
			return !1;
		}
	}, p = (e, t, n) => ({
		live: () => e() && f(t),
		issued: n
	}), m = () => {
		if (i = Symbol(), n.scenario.kind === "loading") return { kind: "idle" };
		if (n.scenario.kind === "ready" && n.scenario.checking) return {
			...n.scenario,
			checking: !1
		};
	}, h = () => {
		if (a = Symbol(), n.lessons.kind === "loading") return { kind: "idle" };
		if (n.lessons.kind === "deciding") return o ? {
			kind: "unavailable",
			code: "READ_INVALIDATED",
			afterDispatch: !0
		} : {
			kind: "ready",
			lessons: n.lessons.lessons,
			selectedId: null,
			notice: "READ_INVALIDATED",
			page: n.lessons.page
		};
	}, g = () => {
		let e = m();
		return e !== void 0 && c({ scenario: e }), Nb("READ_INVALIDATED");
	}, _ = () => {
		let e = h();
		return e !== void 0 && c({ lessons: e }), Nb("READ_INVALIDATED");
	};
	async function v(t, n) {
		let a;
		try {
			a = $v(t);
		} catch {
			return i = Symbol(), c({ scenario: {
				kind: "unavailable",
				selection: null,
				code: "INVALID_REPLY"
			} }), Nb("SELECTION_INVALID");
		}
		if (!f(n)) return Nb("READ_INVALIDATED");
		let o = r, s = Symbol();
		i = s, c({ scenario: {
			kind: "loading",
			selection: a
		} });
		try {
			let t = await e.guarded("scenarios.reopen", a, p(() => u(o, s), n));
			if (!u(o, s)) return Nb("READ_INVALIDATED");
			if (!f(n)) return g();
			let r = uy(t, a);
			return u(o, s) ? f(n) ? (c({ scenario: {
				kind: "ready",
				selection: a,
				view: r,
				historical: dy(r),
				checking: !1
			} }), Mb) : g() : Nb("READ_INVALIDATED");
		} catch (e) {
			if (!u(o, s)) return Nb("READ_INVALIDATED");
			if (!f(n)) return g();
			let t = Hy(e);
			return c({ scenario: {
				kind: "unavailable",
				selection: a,
				code: t
			} }), Nb(t);
		}
	}
	async function y(t, a, o) {
		let s = n.scenario;
		if (s.kind !== "ready" || s.checking || !Ry(s.selection, t) || s.view !== a) return Nb("SELECTION_INVALID");
		if (!f(o)) return Nb("READ_INVALIDATED");
		let l = r, d = Symbol();
		i = d, c({ scenario: {
			...s,
			checking: !0
		} });
		try {
			let t = await e.guarded("scenarios.reopen", s.selection, p(() => u(l, d), o));
			if (!u(l, d)) return Nb("READ_INVALIDATED");
			if (!f(o)) return g();
			let n = uy(t, s.selection);
			return u(l, d) ? f(o) ? Ry(n, s.view) ? (c({ scenario: {
				...s,
				checking: !1
			} }), Mb) : (c({ scenario: {
				kind: "unavailable",
				selection: s.selection,
				code: "SCENARIO_VIEW_CHANGED"
			} }), Nb("SCENARIO_VIEW_CHANGED")) : g() : Nb("READ_INVALIDATED");
		} catch (e) {
			if (!u(l, d)) return Nb("READ_INVALIDATED");
			if (!f(o)) return g();
			let t = Hy(e);
			return c({ scenario: {
				kind: "unavailable",
				selection: s.selection,
				code: t
			} }), Nb(t);
		}
	}
	function b() {
		i = Symbol(), c({ scenario: { kind: "idle" } });
	}
	let x = (e) => {
		let n = t.context();
		return n !== null && n.contextKey === e.contextKey ? n : null;
	};
	async function S(i) {
		if (n.lessons.kind === "deciding") return Nb("DECISION_IN_FLIGHT");
		let o = t.context();
		if (o === null || !f(i)) return Nb("READ_INVALIDATED");
		let s = r, l = Symbol();
		a = l, c({ lessons: { kind: "loading" } });
		try {
			let t = await e.guarded("memory.lessons", {}, p(() => d(s, l), i));
			if (!d(s, l)) return Nb("READ_INVALIDATED");
			if (!f(i)) return _();
			let n = x(o);
			if (n === null) return Nb("READ_INVALIDATED");
			let r = Ay(t, n);
			return d(s, l) ? f(i) ? (c({ lessons: {
				kind: "ready",
				lessons: r,
				selectedId: null,
				notice: null,
				page: 0
			} }), Mb) : _() : Nb("READ_INVALIDATED");
		} catch (e) {
			if (!d(s, l)) return Nb("READ_INVALIDATED");
			if (!f(i)) return _();
			let t = Hy(e);
			return c({ lessons: {
				kind: "unavailable",
				code: t,
				afterDispatch: !1
			} }), Nb(t);
		}
	}
	function C(e) {
		let t = n.lessons;
		if (t.kind !== "ready") return;
		let r = e === null ? -1 : t.lessons.findIndex((t) => t.candidate.id === e), i = r >= 0 && e !== null ? e : null, a = r >= 0 ? jy(r, t.lessons.length) : t.page;
		(i !== t.selectedId || t.notice !== null || a !== t.page) && c({ lessons: {
			kind: "ready",
			lessons: t.lessons,
			selectedId: i,
			notice: null,
			page: a
		} });
	}
	function w(e, t, r) {
		let i = n.lessons;
		i.kind !== "ready" || i.lessons !== e || i.page !== t || !Number.isSafeInteger(r) || r < 0 || r * 5 >= Math.max(1, e.length) || r !== i.page && c({ lessons: {
			...i,
			page: r
		} });
	}
	async function T(i, s, l) {
		let u = n.lessons, m = t.context();
		if (u.kind === "deciding") return Nb("DECISION_IN_FLIGHT");
		if (u.kind !== "ready" || u.selectedId === null || m === null) return Nb("DECISION_UNAVAILABLE");
		let h = u.lessons.find((e) => e.candidate.id === u.selectedId);
		if (h === void 0 || h.review === void 0 || h.evaluation === void 0 || !Ry(Ey(h.candidate), i.candidate) || h.review.id !== i.reviewId || h.review.digest !== i.reviewDigest || h.evaluation.digest !== i.evaluationDigest || !Ny(h, m).ok || i.decision !== "approve" && i.decision !== "defer") return Nb("DECISION_UNAVAILABLE");
		let g = Fy(s);
		if (g === null) return Nb("REASON_REQUIRED");
		if (!f(l)) return Nb("READ_INVALIDATED");
		let v = r, y = Symbol();
		a = y, o = !1, c({ lessons: {
			kind: "deciding",
			lessons: u.lessons,
			selectedId: h.candidate.id,
			decision: i.decision,
			page: u.page
		} });
		let b = !1, S = () => d(v, y);
		try {
			let t = await e.guarded("memory.lessons", {}, p(S, l));
			if (!d(v, y)) return Nb("READ_INVALIDATED");
			if (!f(l)) return _();
			let n = x(m);
			if (n === null) return Nb("READ_INVALIDATED");
			let r = Ay(t, n);
			if (!d(v, y)) return Nb("READ_INVALIDATED");
			if (!f(l)) return _();
			let a = r.find((e) => e.candidate.id === h.candidate.id);
			if (a === void 0 || !Ry(a, h) || !Ny(a, n).ok) return c({ lessons: {
				kind: "ready",
				lessons: r,
				selectedId: null,
				notice: "LESSON_REVIEW_CHANGED",
				page: jy(u.page * 5, r.length)
			} }), Nb("LESSON_REVIEW_CHANGED");
			let s = Iy(h, i, g), C = await e.guarded("memory.decideLesson", s, p(S, l, () => {
				b = !0, o = !0;
			}));
			if (!d(v, y)) return Nb("READ_INVALIDATED");
			if (!f(l)) return _();
			let w = Ly(C, s, h);
			return d(v, y) ? f(l) ? (c({ lessons: {
				kind: "ready",
				lessons: r.map((e) => e.candidate.id === w.candidate.id ? w : e),
				selectedId: null,
				notice: null,
				page: jy(u.page * 5, r.length)
			} }), Mb) : _() : Nb("READ_INVALIDATED");
		} catch (e) {
			if (!d(v, y)) return Nb("READ_INVALIDATED");
			if (!f(l)) return _();
			let t = Hy(e);
			return c({ lessons: {
				kind: "unavailable",
				code: t,
				afterDispatch: b
			} }), Nb(t);
		}
	}
	function ee() {
		let e = {}, t = m(), n = h();
		t !== void 0 && (e.scenario = t), n !== void 0 && (e.lessons = n), (e.scenario !== void 0 || e.lessons !== void 0) && c(e);
	}
	function E() {
		r = Symbol(), i = Symbol(), a = Symbol(), o = !1, c(Pb);
	}
	return Object.freeze({
		snapshot: () => n,
		subscribe(e) {
			return s.add(e), () => {
				s.delete(e);
			};
		},
		openScenario: v,
		confirmScenario: y,
		closeScenario: b,
		readLessons: S,
		selectLesson: C,
		pageLessons: w,
		decideLesson: T,
		cancelPending: ee,
		invalidate: E
	});
}
//#endregion
//#region app/ui/src/host/controller.ts
function Ib(e) {
	return Object.assign(Error(e), { code: e });
}
function Lb(e, t) {
	if (!Number.isFinite(e)) throw Ib("INVALID_REPLY");
	let n = new Intl.DateTimeFormat("en-CA", {
		timeZone: t,
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	}).formatToParts(e), r = (e) => n.find((t) => t.type === e)?.value, i = r("year"), a = r("month"), o = r("day");
	if (!i || !a || !o || !/^\d{4}$/.test(i) || !/^\d{2}$/.test(a) || !/^\d{2}$/.test(o)) throw Ib("INVALID_REPLY");
	let s = String(new Date(Date.UTC(Number(i), Number(a), 0)).getUTCDate()).padStart(2, "0");
	return Object.freeze({
		date: `${i}-${a}-${o}`,
		period: Object.freeze({
			from: `${i}-${a}-01`,
			to: `${i}-${a}-${s}`
		})
	});
}
var Rb = (e, t) => Object.freeze({
	phase: e,
	...t === void 0 ? {} : { code: t },
	context: null,
	today: null,
	routes: Object.freeze([]),
	selectedRouteId: null,
	receipt: null
});
function zb(e, t = {}) {
	let n = t.now ?? Date.now, r = t.timeZone ?? "UTC";
	new Intl.DateTimeFormat("en", { timeZone: r });
	let i = Rb("loading"), a = Symbol(), o = Symbol(), s = !1, c = null, l = null, u = /* @__PURE__ */ new Set();
	function d(e) {
		if (!s) {
			i = Object.freeze(e);
			for (let e of u) e();
		}
	}
	function f(e) {
		return !s && a === e;
	}
	async function p() {
		return Ab(await e.request("ui.context", {}));
	}
	function m(e, t) {
		if (e.contextKey !== t.contextKey || e.workspace.id !== t.workspace.id || e.member.id !== t.member.id || e.member.epoch !== t.member.epoch || e.member.role !== t.member.role) throw C("ACCESS_DENIED"), Ib("ACCESS_DENIED");
	}
	function h(e) {
		if (e === void 0) return !0;
		try {
			return e.live() === !0;
		} catch {
			return !1;
		}
	}
	async function g(t, n, r) {
		let o = a, s = i.context;
		if (!f(o) || s === null || i.phase !== "ready") throw Ib("ACCESS_DENIED");
		if (!h(r)) throw Ib("READ_INVALIDATED");
		try {
			let i = await p();
			if (!f(o)) throw Ib("READ_INVALIDATED");
			if (m(i, s), t === "models.preview" || t === "conversation.ask") {
				let e = Object.getOwnPropertyDescriptor(n, "routeId");
				if (l === null || e?.value !== l.routeId) throw Ib("ACCESS_DENIED");
			}
			if (!h(r)) throw Ib("READ_INVALIDATED");
			r?.issued?.();
			let a = await e.request(t, n);
			if (!f(o)) throw Ib("READ_INVALIDATED");
			let c = await p();
			if (!f(o)) throw Ib("READ_INVALIDATED");
			return m(c, s), a;
		} catch (e) {
			let t = L_(e);
			throw f(o) && (I_(t) || t === "INVALID_REPLY") && C(t), e;
		}
	}
	let _ = {
		request: g,
		guarded: g
	}, v = jv(_), y = z_(_), b = Cb(_, { now: n }), x = Fb(_, { context: () => i.phase === "ready" ? i.context : null });
	function S() {
		a = Symbol(), o = Symbol(), l = null, v.invalidate(), y.invalidate(), b.invalidate(), x.invalidate();
	}
	function C(e = "READ_INVALIDATED") {
		S(), b.invalidate(e), d(Rb(e === "VAULT_LOCKED" ? "locked" : "unavailable", e));
	}
	async function w() {
		if (s || i.phase === "locked") return;
		S(), d(Rb("loading"));
		let e = a;
		try {
			let t = await p();
			if (!f(e)) return;
			d({
				...Rb("ready"),
				context: t
			});
			let a = Lb(n(), r), o = {
				title: "Today",
				date: a.date,
				request: { period: a.period },
				selections: [
					{
						operation: "billed",
						figureKey: "total"
					},
					{
						operation: "received",
						figureKey: "total"
					},
					{
						operation: "margin",
						figureKey: "contribution"
					}
				]
			}, s = await v.dashboard(o);
			if (!f(e)) return;
			if (!s.ok) {
				C(s.code);
				return;
			}
			let c = jb(await g("models.list", {}));
			if (!f(e)) return;
			d({
				...i,
				today: s.value,
				routes: c
			});
		} catch (t) {
			f(e) && C(L_(t));
		}
	}
	function T() {
		if (c !== null) return c;
		let e = a, t = i.context;
		return !f(e) || i.phase !== "ready" || t === null ? Promise.resolve() : (c = (async () => {
			try {
				let n = await p();
				f(e) && m(n, t);
			} catch (t) {
				f(e) && C(L_(t));
			} finally {
				c = null;
			}
		})(), c);
	}
	function ee(e) {
		if (s || i.phase !== "ready" || i.context === null) return;
		let t = e === null ? null : i.routes.find((t) => t.id === e && t.enabled);
		if (e !== null && t === void 0) {
			C("INVALID_REPLY");
			return;
		}
		S(), l = t == null || i.context.member.role === "viewer" ? null : Object.freeze({
			purpose: "conversation",
			questionDisclosure: "verbatim",
			routeId: t.id
		}), d({
			...i,
			selectedRouteId: l?.routeId ?? null,
			receipt: null
		});
	}
	async function E(e, t) {
		if (s || i.context === null || i.phase !== "ready") return;
		let n;
		try {
			if (n = Object.freeze(Hn(Un(t))), n.sheet === void 0 || !Wn(n, t)) throw Ib("INVALID_REPLY");
		} catch {
			C("INVALID_REPLY");
			return;
		}
		let r = a, c = Symbol();
		o = c, d({
			...i,
			receipt: Object.freeze({
				id: e,
				address: n,
				kind: "loading"
			})
		});
		let l = await y.receipt(e);
		if (f(r) && o === c) {
			if (!l.ok) {
				I_(l.code) || l.code === "INVALID_REPLY" ? C(l.code) : d({
					...i,
					receipt: Object.freeze({
						id: e,
						address: n,
						kind: "failed",
						code: l.code
					})
				});
				return;
			}
			d({
				...i,
				receipt: Object.freeze({
					id: e,
					address: n,
					kind: "ready",
					value: l.value
				})
			});
		}
	}
	function te() {
		o = Symbol(), s || d({
			...i,
			receipt: null
		});
	}
	async function D() {
		if (s) return;
		let t = i.context?.member.role;
		if (C("VAULT_LOCKED"), t === "owner" || t === "cofounder") try {
			await e.request("workspace.lock", {});
		} catch (e) {
			s || C(L_(e));
		}
	}
	return Object.freeze({
		conversation: b,
		retained: x,
		timeZone: r,
		snapshot: () => i,
		subscribe(e) {
			return s ? () => {} : (u.add(e), () => {
				u.delete(e);
			});
		},
		refresh: w,
		checkAuthority: T,
		selectRoute: ee,
		questionSettings: () => l,
		openReceipt: E,
		closeReceipt: te,
		invalidate: C,
		lock: D,
		dispose() {
			s || (S(), d(Rb("unavailable", "READ_INVALIDATED")), s = !0, u.clear());
		}
	});
}
//#endregion
//#region app/ui/src/host/bootstrap.tsx
var Bb = {
	place: "today",
	sub: "today"
}, Vb = {
	place: "ask",
	sub: "new"
}, Hb = {
	place: "trust",
	sub: "models"
}, Ub = {
	owner: "roleOwner",
	cofounder: "roleCofounder",
	accountant: "roleAccountant",
	viewer: "roleViewer"
};
function Wb(e) {
	window.location.hash = Un(e);
}
function Gb() {
	return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
function Kb(e, t) {
	return e.place === t.place && e.sub === t.sub;
}
function qb({ routes: e, selected: t, language: n, viewer: r, onSelect: i }) {
	let a = "host-route-label";
	return /* @__PURE__ */ (0, A.jsxs)("section", { children: [
		/* @__PURE__ */ (0, A.jsx)(Up, {
			where: $(n, "routeLabel"),
			title: $(n, "routesTitle")
		}),
		/* @__PURE__ */ (0, A.jsx)("p", {
			className: G.note,
			children: $(n, "routesNote")
		}),
		/* @__PURE__ */ (0, A.jsx)("p", {
			className: G.note,
			children: $(n, "routesUnverified")
		}),
		r ? /* @__PURE__ */ (0, A.jsx)("p", {
			role: "status",
			children: $(n, "viewerNoAsk")
		}) : e.length === 0 ? /* @__PURE__ */ (0, A.jsx)("p", {
			role: "status",
			children: $(n, "routesEmpty")
		}) : /* @__PURE__ */ (0, A.jsxs)("div", {
			className: G.block,
			children: [
				/* @__PURE__ */ (0, A.jsx)("label", {
					id: a,
					htmlFor: "host-route",
					children: $(n, "routeLabel")
				}),
				/* @__PURE__ */ (0, A.jsxs)("select", {
					id: "host-route",
					"aria-labelledby": a,
					value: t ?? "",
					onChange: (e) => i(e.currentTarget.value || null),
					children: [/* @__PURE__ */ (0, A.jsx)("option", {
						value: "",
						children: $(n, "routePlaceholder")
					}), e.map((e) => /* @__PURE__ */ (0, A.jsx)("option", {
						value: e.id,
						disabled: !e.enabled,
						children: e.enabled ? $(n, "routeDescription", {
							label: e.label,
							kind: e.kind,
							model: e.model
						}) : $(n, "routeDisabled", { label: e.label })
					}, e.id))]
				}),
				t !== null && /* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "link",
					onClick: () => i(null),
					children: $(n, "routeClear")
				})
			]
		})
	] });
}
function Jb({ value: e, language: t }) {
	let n = gb(t), r = (e) => $(t, e), i = (e) => e === null ? n["not-applicable"] : $(t, "dateRange", {
		from: e.from,
		to: e.to
	}), a = (e) => e.length === 0 ? r("none") : e.join(", "), o = e.coverage.completeness !== "empty" && (e.coverage.completeness !== "partial" || e.coverage.countedRows !== 0), s = (e) => /* @__PURE__ */ (0, A.jsx)("dl", {
		className: G.pairs,
		children: e.map(([e, t]) => /* @__PURE__ */ (0, A.jsxs)("div", {
			className: G.pair,
			children: [/* @__PURE__ */ (0, A.jsx)("dt", {
				className: G.name,
				children: e
			}), /* @__PURE__ */ (0, A.jsx)("dd", {
				className: G.value,
				children: t
			})]
		}, e))
	});
	return /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [
		/* @__PURE__ */ (0, A.jsx)("p", {
			className: G.note,
			children: r("receiptSubset")
		}),
		/* @__PURE__ */ (0, A.jsx)("p", {
			className: G.note,
			children: r(e.stale ? "stale" : "fresh")
		}),
		e.staleReason !== void 0 && /* @__PURE__ */ (0, A.jsx)("p", {
			className: G.exact,
			children: e.staleReason
		}),
		!o && /* @__PURE__ */ (0, A.jsx)("p", {
			role: "status",
			children: r("receiptUnknown")
		}),
		/* @__PURE__ */ (0, A.jsxs)("section", {
			className: G.block,
			children: [/* @__PURE__ */ (0, A.jsx)("h3", {
				className: G.label,
				children: r("figures")
			}), o && e.figures.length > 0 ? e.figures.map((n) => /* @__PURE__ */ (0, A.jsxs)("div", {
				className: G.block,
				children: [
					/* @__PURE__ */ (0, A.jsx)("p", {
						className: G.exact,
						children: n.label
					}),
					/* @__PURE__ */ (0, A.jsx)("p", {
						className: G.exact,
						children: n.display
					}),
					/* @__PURE__ */ (0, A.jsx)("p", {
						className: G.note,
						children: n.unit === "basis-points" ? $(t, "exactPoints", { minor: n.minor }) : $(t, "exactMoney", {
							minor: n.minor,
							currency: n.currency ?? e.currency
						})
					})
				]
			}, n.key)) : /* @__PURE__ */ (0, A.jsx)("p", { children: n.unknown })]
		}),
		/* @__PURE__ */ (0, A.jsxs)("section", {
			className: G.block,
			children: [/* @__PURE__ */ (0, A.jsx)("h3", {
				className: G.label,
				children: r("scope")
			}), s([
				[r("receiptId"), e.id],
				[r("operation"), e.operation],
				[r("createdAt"), e.createdAt],
				[r("asOf"), e.asOf],
				[r("period"), i(e.period)],
				[r("comparePeriod"), i(e.comparePeriod)],
				[r("branch"), e.branch ?? n["not-applicable"]],
				[r("currency"), e.currency],
				[r("requestedSources"), e.requestedSourceIds === void 0 ? r("selectionAbsent") : e.requestedSourceIds.length === 0 ? r("selectionEmpty") : a(e.requestedSourceIds)],
				[r("countedSources"), a(e.sourceIds)]
			])]
		}),
		/* @__PURE__ */ (0, A.jsxs)("section", {
			className: G.block,
			children: [
				/* @__PURE__ */ (0, A.jsx)("h3", {
					className: G.label,
					children: r("coverage")
				}),
				s([
					[r("completeness"), e.coverage.completeness],
					[r("selectedRows"), String(e.coverage.selectedRows)],
					[r("countedRows"), String(e.coverage.countedRows)],
					[r("excludedRows"), String(e.coverage.excludedRows)],
					[r("unresolvedConflicts"), String(e.coverage.unresolvedConflicts)],
					[r("imports"), a(e.coverage.importIds)]
				]),
				/* @__PURE__ */ (0, A.jsx)("h4", {
					className: G.label,
					children: r("gaps")
				}),
				e.coverage.gaps.length > 0 ? /* @__PURE__ */ (0, A.jsx)("ul", { children: e.coverage.gaps.map((e, t) => /* @__PURE__ */ (0, A.jsx)("li", { children: e }, t)) }) : /* @__PURE__ */ (0, A.jsx)("p", { children: r("none") })
			]
		}),
		/* @__PURE__ */ (0, A.jsxs)("section", {
			className: G.block,
			children: [/* @__PURE__ */ (0, A.jsx)("h3", {
				className: G.label,
				children: r("explanation")
			}), /* @__PURE__ */ (0, A.jsx)("p", {
				className: G.exact,
				children: e.explanation
			})]
		}),
		/* @__PURE__ */ (0, A.jsxs)("section", {
			className: G.block,
			children: [/* @__PURE__ */ (0, A.jsx)("h3", {
				className: G.label,
				children: r("hashes")
			}), s([
				[r("dictionaryHash"), e.dictionaryHash],
				[r("definitionHash"), e.definitionHash],
				[r("ontologyVersion"), String(e.ontologyVersion)]
			])]
		}),
		/* @__PURE__ */ (0, A.jsxs)("details", { children: [/* @__PURE__ */ (0, A.jsx)("summary", { children: r("ledger") }), /* @__PURE__ */ (0, A.jsx)("pre", {
			className: G.payload,
			children: JSON.stringify({
				rowIds: e.rowIds,
				rows: e.rows,
				exclusions: e.exclusions
			}, null, 2)
		})] }),
		/* @__PURE__ */ (0, A.jsxs)("details", { children: [/* @__PURE__ */ (0, A.jsx)("summary", { children: r("assumptions") }), /* @__PURE__ */ (0, A.jsx)("pre", {
			className: G.payload,
			children: JSON.stringify(e.assumptions, null, 2)
		})] }),
		/* @__PURE__ */ (0, A.jsxs)("details", { children: [
			/* @__PURE__ */ (0, A.jsx)("summary", { children: r("exactFields") }),
			!o && /* @__PURE__ */ (0, A.jsx)("p", { children: r("receiptUnknown") }),
			/* @__PURE__ */ (0, A.jsx)("pre", {
				className: G.payload,
				children: JSON.stringify(e, null, 2)
			})
		] })
	] });
}
function Yb({ selection: e, language: t, origin: n, onClose: r }) {
	return /* @__PURE__ */ (0, A.jsxs)(Cp, {
		kind: $(t, "receipt"),
		title: e.id,
		origin: n,
		onClose: r,
		children: [e.kind === "ready" ? /* @__PURE__ */ (0, A.jsx)(Jb, {
			value: e.value,
			language: t
		}) : /* @__PURE__ */ (0, A.jsx)("p", {
			role: "status",
			children: $(t, e.kind === "loading" ? "receiptLoading" : "receiptFailed")
		}), e.kind === "failed" && /* @__PURE__ */ (0, A.jsx)("p", { children: $(t, "code", { code: e.code }) })]
	});
}
function Xb({ language: e }) {
	return /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [
		/* @__PURE__ */ (0, A.jsx)("dl", {
			className: G.pairs,
			children: [
				["Ctrl K", "helpAsk"],
				["Ctrl 1–7", "helpPlaces"],
				["Esc", "helpClose"],
				["F6 / Shift F6", "helpRegions"],
				["Ctrl /", "helpList"]
			].map(([t, n]) => /* @__PURE__ */ (0, A.jsxs)("div", {
				className: G.pair,
				children: [/* @__PURE__ */ (0, A.jsx)("dt", {
					className: G.name,
					children: t
				}), /* @__PURE__ */ (0, A.jsx)("dd", {
					className: G.value,
					children: $(e, n)
				})]
			}, t))
		}),
		/* @__PURE__ */ (0, A.jsx)("p", { children: $(e, "helpSendGuard") }),
		/* @__PURE__ */ (0, A.jsx)("p", { children: $(e, "helpUnavailable") })
	] });
}
function Zb({ runId: e, scenario: t, language: n, origin: r, onClose: i }) {
	let a = j(), o = t.kind === "ready" ? my(t.view, e) : null;
	return /* @__PURE__ */ (0, A.jsx)(Cp, {
		kind: a("RETAINED.proof.kind"),
		title: o === null ? a("RETAINED.proof.kind") : o.result.receipt.id,
		origin: r,
		onClose: i,
		children: o === null ? /* @__PURE__ */ (0, A.jsx)("p", {
			role: "status",
			children: a("RETAINED.proof.unavailable")
		}) : /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [
			/* @__PURE__ */ (0, A.jsxs)("p", {
				className: G.note,
				children: [
					/* @__PURE__ */ (0, A.jsx)(Mp, { kind: "what-if" }),
					" ",
					a("RETAINED.proof.note")
				]
			}),
			((e) => /* @__PURE__ */ (0, A.jsx)("dl", {
				className: G.pairs,
				children: e.map(([e, t], n) => /* @__PURE__ */ (0, A.jsxs)("div", {
					className: G.pair,
					children: [/* @__PURE__ */ (0, A.jsx)("dt", {
						className: G.name,
						children: e
					}), /* @__PURE__ */ (0, A.jsx)("dd", {
						className: [G.value, "fig"].join(" "),
						children: t
					})]
				}, `${e}-${n}`))
			}))([
				[a("RETAINED.proof.branch"), o.branch.label],
				[a("RETAINED.proof.assumption"), o.branch.role === "baseline" ? a("RETAINED.scenario.assumption", { bps: o.branch.priceChangeBps }) : a("RETAINED.scenario.assumptionChange", {
					before: o.baseline.priceChangeBps,
					after: o.branch.priceChangeBps
				})],
				[a("RETAINED.proof.jobLabel"), o.job.label],
				[a("RETAINED.proof.job"), o.job.id],
				[a("RETAINED.proof.run"), o.result.runId],
				[a("RETAINED.proof.runDigest"), o.result.runDigest],
				[a("RETAINED.proof.receiptDigest"), o.result.receiptDigest],
				[a("RETAINED.proof.resultDigest"), o.result.digest],
				[a("RETAINED.proof.revision"), o.view.revision.id],
				[a("RETAINED.scenario.headRevision"), o.view.headRevisionId],
				[a("RETAINED.proof.evidence"), o.view.revision.evidenceId],
				[a("RETAINED.scenario.evidenceDigest"), o.view.revision.evidenceDigest],
				...o.state.reusedFromRevisionId === void 0 ? [] : [[a("RETAINED.scenario.reusedFrom"), o.state.reusedFromRevisionId]]
			]),
			/* @__PURE__ */ (0, A.jsx)(Jb, {
				value: o.result.receipt,
				language: n
			})
		] })
	});
}
function Qb({ scenario: e, origin: t, onClose: n }) {
	let r = j(), i = e.kind === "ready" ? e : null;
	return /* @__PURE__ */ (0, A.jsx)(Cp, {
		kind: r("RETAINED.scenario.provenance"),
		title: i === null ? r("RETAINED.scenario.title") : i.view.revision.id,
		origin: t,
		onClose: n,
		children: i === null ? /* @__PURE__ */ (0, A.jsx)("p", {
			role: "status",
			children: r("RETAINED.proof.unavailable")
		}) : /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsxs)("p", {
			className: G.note,
			children: [
				/* @__PURE__ */ (0, A.jsx)(Mp, { kind: "what-if" }),
				" ",
				r("RETAINED.scenario.identity", {
					scenario: i.view.scenarioId,
					revision: i.view.revision.id,
					createdAt: i.view.revision.createdAt
				})
			]
		}), /* @__PURE__ */ (0, A.jsx)(Zy, {
			view: i.view,
			historical: i.historical
		})] })
	});
}
function $b(e) {
	return [
		e.candidate.id,
		e.candidate.digest,
		e.evaluation?.digest ?? "",
		e.review?.id ?? "",
		e.review?.digest ?? ""
	].join(":");
}
function ex({ id: e, scope: t, lessons: n, context: r, origin: i, onClose: a, onAdjacent: o, onDecide: s }) {
	let c = j(), l = n.kind === "ready" || n.kind === "deciding" ? n.lessons : [], u = l.findIndex((t) => t.candidate.id === e), d = u >= 0 ? l[u] : void 0, f = () => a(e, {
		list: l,
		view: d
	});
	return d === void 0 ? /* @__PURE__ */ (0, A.jsx)(Cp, {
		kind: c("RETAINED.lesson.sheet"),
		title: c("RETAINED.lesson.sheet"),
		origin: i,
		onClose: f,
		children: /* @__PURE__ */ (0, A.jsx)("p", {
			role: "status",
			children: c("RETAINED.lesson.sheetUnavailable")
		})
	}) : /* @__PURE__ */ (0, A.jsx)(db, {
		view: d,
		availability: Ny(d, r),
		deciding: n.kind === "deciding",
		position: {
			index: String(u + 1),
			total: String(l.length)
		},
		origin: i,
		onClose: f,
		onAdjacent: (e) => {
			let t = l[u + e];
			t !== void 0 && o(t.candidate.id, {
				list: l,
				from: d.candidate.id
			});
		},
		onDecide: s
	}, `${$b(d)}:${t}`);
}
var tx = "what-if-proof", nx = "what-if-provenance", rx = "lesson";
function ix({ controller: e, state: t, context: n, language: r, view: i, setLanguage: a, setView: o, onLegacyReturn: s, scenarioSelection: c }) {
	let l = JSON.stringify([n.contextKey, t.selectedRouteId]), u = (0, _.useSyncExternalStore)(e.retained.subscribe, e.retained.snapshot, e.retained.snapshot), d = (0, _.useRef)(Bb), f = (0, _.useRef)(null), p = (0, _.useRef)(null), m = (0, _.useRef)(null), h = (0, _.useRef)(0), [g, v] = (0, _.useState)(void 0), [y, b] = (0, _.useState)(null), x = (0, _.useRef)(y);
	x.current = y;
	let S = n.member.role === "viewer", C = t.routes.find((e) => e.id === t.selectedRouteId && e.enabled), w = e.questionSettings(), T = !S && C !== void 0 && w !== null && w.routeId === C.id, ee = (0, _.useMemo)(() => {
		if (t.today === null) return { kind: "missing" };
		try {
			return {
				kind: "ready",
				value: Mv(t.today, {
					language: r,
					timeZone: e.timeZone,
					missingWords: gb(r)
				})
			};
		} catch {
			return { kind: "invalid" };
		}
	}, [
		t.today,
		r,
		e.timeZone
	]);
	(0, _.useLayoutEffect)(() => {
		ee.kind === "invalid" && e.invalidate("INVALID_REPLY");
	}, [ee.kind, e]);
	let E = (0, _.useCallback)((t) => {
		let n = d.current;
		d.current = t;
		let r = e.snapshot().receipt;
		r !== null && (t === null || !Wn(r.address, t)) && e.closeReceipt();
		let i = x.current;
		i !== null && (t === null || !Wn(i.address, t)) && (i.kind === rx && e.retained.selectLesson(null), b(null)), n === null || t === null || !Kb(n, t) ? e.retained.invalidate() : Wn(n, t) || e.retained.cancelPending();
		let a = i !== null && t !== null && Wn(i.address, t);
		t !== null && !a && (t.sheet === tx || t.sheet === nx || t.sheet === rx) && Wb(Gn(t));
	}, [e]), te = () => {
		let r = e.snapshot();
		return r.phase === "ready" && r.context?.contextKey === n.contextKey && r.selectedRouteId === t.selectedRouteId;
	}, D = (0, _.useCallback)((r) => {
		let i = e.snapshot();
		return i.phase === "ready" && i.context?.contextKey === n.contextKey && i.selectedRouteId === t.selectedRouteId && Wn(Hn(window.location.hash), r);
	}, [
		e,
		n.contextKey,
		t.selectedRouteId
	]), O = () => {
		x.current?.kind === rx && e.retained.selectLesson(null);
	}, ne = u.lessons.kind === "ready" || u.lessons.kind === "deciding" ? u.lessons.selectedId : null;
	(0, _.useEffect)(() => {
		let e = x.current;
		e?.kind === rx && e.id !== ne && (x.current = null, b(null), Wn(Hn(window.location.hash), e.address) && Wb(Gn(e.address)));
	}, [ne]);
	let re = (e) => {
		if (!te() || !T) return;
		let t = {
			place: "ask",
			sub: "saved"
		};
		h.current += 1, v({
			id: e,
			address: t,
			selectionKey: String(h.current)
		}), Wb(t);
	}, ie = () => {
		let t = x.current?.kind === "help" ? f.current?.isConnected ? f.current : p.current : null;
		O(), e.retained.cancelPending(), e.closeReceipt(), x.current = null, b(null), t?.isConnected && t.focus();
		let n = m.current;
		m.current = null, n !== null && te() ? re(n) : d.current !== null && Wb(Gn(d.current));
	}, ae = (t, n = null) => {
		if (!te() || d.current === null) return;
		f.current = Gb(), m.current = n, O(), e.retained.cancelPending(), b(null);
		let r = Kn(d.current, "receipt");
		Wb(r), e.openReceipt(t, r);
	}, oe = (t, n, r, i) => {
		let a = d.current;
		if (a === null || a.sheet !== void 0 || fb(a) !== "scenario" || !D(a)) return;
		let o = e.retained.snapshot().scenario;
		if (o.kind !== "ready" || o.checking || o.view !== i || n !== void 0 && my(o.view, n) === null) return;
		let s = r ?? Gb();
		e.retained.confirmScenario(o.selection, o.view, () => D(a)).then((r) => {
			if (!r.ok || x.current !== null || e.snapshot().receipt !== null || !D(a)) return;
			let i = e.retained.snapshot().scenario;
			if (i.kind !== "ready" || i.checking || i.view !== o.view || n !== void 0 && my(i.view, n) === null) return;
			f.current = s?.isConnected ? s : Gb(), m.current = null, O();
			let c = Kn(a, t), l = n === void 0 ? {
				address: c,
				kind: t
			} : {
				address: c,
				kind: t,
				id: n
			};
			x.current = l, b(l), Wb(c);
		});
	}, se = (e, t, n) => oe(tx, e, t, n), ce = (e, t) => oe(nx, void 0, e, t), le = () => x.current?.kind === rx ? x.current.id ?? null : null, ue = (t, n, r) => {
		let i = d.current;
		if (i === null || !D(i)) return;
		let a = Gn(i);
		if (fb(a) !== "lessons" || i.sheet !== void 0 && i.sheet !== rx) return;
		let o = e.retained.snapshot().lessons;
		if (o.kind !== "ready" || o.lessons !== r.list || !o.lessons.some((e) => e.candidate.id === t) || o.selectedId !== r.from || le() !== r.from || r.page !== void 0 && o.page !== r.page) return;
		f.current = n ?? Gb(), m.current = null, e.closeReceipt(), e.retained.selectLesson(t);
		let s = Kn(a, rx), c = {
			address: s,
			kind: rx,
			id: t
		};
		x.current = c, b(c), Wb(s);
	}, de = (t, n) => {
		let r = x.current;
		if (r?.kind !== rx || r.id !== t || !D(r.address)) return;
		let i = e.retained.snapshot().lessons, a = i.kind === "ready" || i.kind === "deciding" ? i : null;
		(a === null ? n.view !== void 0 : a.lessons !== n.list || a.selectedId !== t || a.lessons.find((e) => e.candidate.id === t) !== n.view) || ie();
	}, fe = (t, n) => {
		let r = x.current;
		if (r?.kind !== rx || r.id !== t.candidate.id || !D(r.address)) return;
		let i = e.retained.snapshot().lessons;
		i.kind === "ready" && i.selectedId === t.candidate.id && e.retained.decideLesson(t, n, () => D(r.address) && x.current?.kind === rx && x.current.id === t.candidate.id);
	}, pe = (t, n = null) => {
		if (!te() || d.current === null) return;
		f.current = Gb(), m.current = n, O(), e.retained.cancelPending(), e.closeReceipt();
		let r = Kn(d.current, "reference");
		b({
			address: r,
			kind: "reference",
			id: t
		}), Wb(r);
	}, me = (e, t) => {
		e.kind === "calculation-receipt" ? ae(e.id, t.id) : e.kind === "answer" ? re(e.id) : pe(e.kind === "synthesis-receipt" ? e.receipt.id : e.id, t.id);
	}, he = (t) => {
		te() && (e.selectRoute(t), Wb(t === null ? Bb : Vb));
	}, ge = () => {
		if (!te() || d.current === null) return;
		f.current = Gb(), m.current = null, O(), e.retained.cancelPending(), e.closeReceipt();
		let t = Kn(d.current, "about");
		b({
			address: t,
			kind: "about"
		}), Wb(t);
	}, _e = (t, n) => {
		if (!te() || d.current === null || x.current?.kind === "help") return;
		let r = t === void 0 ? Gb() : t, i = r?.closest("[data-region=\"sheet\"]") ? f.current : r;
		p.current = n?.isConnected ? n : null, f.current = i?.isConnected ? i : n?.isConnected ? n : null, m.current = null, O(), e.retained.cancelPending(), e.closeReceipt();
		let a = Kn(d.current, "help"), o = {
			address: a,
			kind: "help"
		};
		x.current = o, b(o), Wb(a);
	};
	if (ee.kind === "invalid") return /* @__PURE__ */ (0, A.jsx)(Vp, { state: {
		kind: "failed",
		code: "INVALID_REPLY"
	} });
	let ve = gb(r), ye = ee.kind === "ready" ? ee.value.data : {
		state: { kind: "loading" },
		date: "",
		review: {
			count: {
				exact: null,
				display: ve["not-loaded-yet"]
			},
			rows: []
		},
		thisMonthMissing: "not-loaded-yet",
		earlierTodayMissing: "unknown"
	}, be = /* @__PURE__ */ (0, A.jsx)(wr, {
		variant: "link",
		onClick: s,
		children: $(r, "legacy")
	}), xe = t.receipt === null ? y === null ? void 0 : y.kind === tx && y.id !== void 0 ? {
		address: y.address,
		content: /* @__PURE__ */ (0, A.jsx)(Zb, {
			runId: y.id,
			scenario: u.scenario,
			language: r,
			origin: f.current,
			onClose: ie
		}, y.id)
	} : y.kind === nx ? {
		address: y.address,
		content: /* @__PURE__ */ (0, A.jsx)(Qb, {
			scenario: u.scenario,
			origin: f.current,
			onClose: ie
		})
	} : y.kind === rx && y.id !== void 0 ? {
		address: y.address,
		content: /* @__PURE__ */ (0, A.jsx)(ex, {
			id: y.id,
			scope: `${Un(y.address)}:${l}`,
			lessons: u.lessons,
			context: n,
			origin: f.current,
			onClose: de,
			onAdjacent: (e, t) => ue(e, f.current, t),
			onDecide: fe
		}, y.id)
	} : {
		address: y.address,
		content: /* @__PURE__ */ (0, A.jsxs)(Cp, {
			kind: $(r, y.kind === "help" ? "helpTitle" : y.kind === "about" ? "aboutTitle" : "reference"),
			title: $(r, y.kind === "help" ? "helpTitle" : y.kind === "about" ? "aboutTitle" : "reference"),
			origin: f.current,
			onClose: ie,
			children: [
				y.kind === "help" ? /* @__PURE__ */ (0, A.jsx)(Xb, { language: r }) : /* @__PURE__ */ (0, A.jsx)("p", { children: $(r, y.kind === "about" ? "about" : "referenceUnavailable") }),
				y.id !== void 0 && /* @__PURE__ */ (0, A.jsx)("p", {
					className: G.exact,
					children: $(r, "referenceIdentity", { id: y.id })
				}),
				/* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "link",
					onClick: s,
					children: $(r, "legacy")
				})
			]
		})
	} : {
		address: t.receipt.address,
		content: /* @__PURE__ */ (0, A.jsx)(Yb, {
			selection: t.receipt,
			language: r,
			origin: f.current,
			onClose: ie
		}, t.receipt.id)
	}, k = {
		shellKind: "desktop",
		view: i,
		language: r,
		menu: {
			workspace: {
				name: n.workspace.name,
				demo: n.workspace.demo,
				who: $(r, "memberRole", {
					name: n.member.name,
					role: $(r, Ub[n.member.role])
				})
			},
			onSetView: o,
			onSetLanguage: a,
			onLock: () => {
				e.lock();
			},
			onAbout: ge
		},
		ask: {
			onAsk: () => Wb(Vb),
			noModel: !T,
			...S ? { readOnly: { holder: $(r, "roleViewer") } } : {}
		},
		status: {
			sources: {
				text: $(r, ee.kind === "ready" ? "sourcesReady" : "sourcesMissing"),
				address: {
					place: "books",
					sub: "sources"
				}
			},
			model: {
				text: C === void 0 ? $(r, "routeMissing") : $(r, "routeSelected", { label: C.label }),
				address: Hb
			},
			third: { text: $(r, "third") }
		},
		statusSimple: [$(r, ee.kind === "ready" ? "sourcesReady" : "sourcesMissing"), C === void 0 ? $(r, "routeMissing") : $(r, "routeSelected", { label: C.label })],
		capabilities: {},
		today: {
			data: ye,
			intents: {
				onReview: (e) => pe(e),
				onReceipt: (e) => ae(e)
			}
		},
		sheet: xe,
		onAddress: E,
		onHelp: _e,
		renderPlace: (n) => fb(n) === null ? n.place === "trust" && n.sub === "models" || n.place === "ask" && (n.sub === void 0 || n.sub === "new") ? /* @__PURE__ */ (0, A.jsx)(qb, {
			routes: t.routes,
			selected: t.selectedRouteId,
			language: r,
			viewer: S,
			onSelect: he
		}) : /* @__PURE__ */ (0, A.jsxs)(A.Fragment, { children: [/* @__PURE__ */ (0, A.jsx)(Vp, { state: { kind: "not-built" } }), be] }) : /* @__PURE__ */ (0, A.jsx)(pb, {
			address: n,
			retained: e.retained,
			scenarioSelection: c,
			live: D,
			onProof: se,
			onProvenance: ce,
			onOpenLesson: (e, t, n) => ue(e, t, n),
			legacy: be
		})
	};
	return T && w !== null ? /* @__PURE__ */ (0, A.jsx)(O_, {
		app: k,
		conversation: e.conversation,
		questionSettings: w,
		contextKey: l,
		readback: g,
		onReference: me
	}) : /* @__PURE__ */ (0, A.jsx)(Qm, { ...k }, l);
}
function ax({ controller: e, options: t, onLegacyReturn: n }) {
	let r = (0, _.useSyncExternalStore)(e.subscribe, e.snapshot, e.snapshot), [i, a] = (0, _.useState)(t.language ?? "en"), [o, s] = (0, _.useState)(t.view ?? "guided");
	(0, _.useEffect)(() => {
		e.refresh();
	}, [e]), (0, _.useEffect)(() => {
		document.documentElement.lang = i, document.documentElement.removeAttribute("data-theme");
	}, [i]);
	let c = r.phase === "ready" && r.context !== null;
	return /* @__PURE__ */ (0, A.jsx)(Fn, {
		language: i,
		children: /* @__PURE__ */ (0, A.jsxs)("div", {
			style: {
				height: "100vh",
				display: "grid",
				gridTemplateRows: "auto minmax(0, 1fr)"
			},
			children: [/* @__PURE__ */ (0, A.jsxs)("div", {
				style: {
					display: "flex",
					flexWrap: "wrap",
					gap: "var(--sp4)",
					padding: "var(--sp2) var(--sp4)",
					borderBottom: "var(--hair) solid var(--line)"
				},
				children: [/* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "link",
					onClick: n,
					children: $(i, "legacy")
				}), /* @__PURE__ */ (0, A.jsx)(wr, {
					variant: "link",
					onClick: () => {
						e.refresh();
					},
					disabled: r.phase === "loading" || r.phase === "locked",
					children: $(i, "refresh")
				})]
			}), /* @__PURE__ */ (0, A.jsx)("div", {
				"data-host-workspace": "",
				style: {
					minHeight: 0,
					overflow: "auto"
				},
				children: c && r.context !== null ? /* @__PURE__ */ (0, A.jsx)(ix, {
					controller: e,
					state: r,
					context: r.context,
					language: i,
					view: o,
					setLanguage: a,
					setView: s,
					onLegacyReturn: n,
					scenarioSelection: t.scenarioSelection ?? null
				}, JSON.stringify([r.context.contextKey, r.selectedRouteId])) : /* @__PURE__ */ (0, A.jsxs)("div", {
					style: { padding: "var(--sp6)" },
					children: [/* @__PURE__ */ (0, A.jsx)("p", {
						role: "status",
						children: $(i, r.phase === "loading" ? "loading" : r.phase === "locked" ? "locked" : "unavailable")
					}), r.code !== void 0 && /* @__PURE__ */ (0, A.jsx)("p", { children: $(i, "code", { code: r.code }) })]
				})
			})]
		})
	});
}
function ox(e, t, n = {}) {
	Wb(Bb), document.documentElement.removeAttribute("data-theme");
	let r = (0, v.createRoot)(e), i = !1, a = () => {
		i || (i = !0, t.dispose(), r.unmount());
	};
	return r.render(/* @__PURE__ */ (0, A.jsx)(ax, {
		controller: t,
		options: n,
		onLegacyReturn: () => {
			a(), n.onLegacyReturn ? n.onLegacyReturn() : window.location.assign("/index.html");
		}
	})), Object.freeze({
		unmount: a,
		dispose: a
	});
}
//#endregion
export { N_ as createDesktopRequestPort, zb as createHostController, ox as mountHost };

//# sourceMappingURL=host.js.map