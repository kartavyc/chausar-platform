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
	function ne(e) {
		return typeof e == "object" && !!e && e.$$typeof === t;
	}
	function D(e) {
		var t = {
			"=": "=0",
			":": "=2"
		};
		return "$" + e.replace(/[=:]/g, function(e) {
			return t[e];
		});
	}
	var re = /\/+/g;
	function ie(e, t) {
		return typeof e == "object" && e && e.key != null ? D("" + e.key) : t.toString(36);
	}
	function ae(e) {
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
	function oe(e, r, i, a, o) {
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
				case d: return c = e._init, oe(c(e._payload), r, i, a, o);
			}
		}
		if (c) return o = o(e), c = a === "" ? "." + ie(e, 0) : a, C(o) ? (i = "", c != null && (i = c.replace(re, "$&/") + "/"), oe(o, r, i, "", function(e) {
			return e;
		})) : o != null && (ne(o) && (o = te(o, i + (o.key == null || e && e.key === o.key ? "" : ("" + o.key).replace(re, "$&/") + "/") + c)), r.push(o)), 1;
		c = 0;
		var l = a === "" ? "." : a + ":";
		if (C(e)) for (var u = 0; u < e.length; u++) a = e[u], s = l + ie(a, u), c += oe(a, r, i, s, o);
		else if (u = h(e), typeof u == "function") for (e = u.call(e), u = 0; !(a = e.next()).done;) a = a.value, s = l + ie(a, u++), c += oe(a, r, i, s, o);
		else if (s === "object") {
			if (typeof e.then == "function") return oe(ae(e), r, i, a, o);
			throw r = String(e), Error("Objects are not valid as a React child (found: " + (r === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : r) + "). If you meant to render a collection of children, use an array instead.");
		}
		return c;
	}
	function se(e, t, n) {
		if (e == null) return e;
		var r = [], i = 0;
		return oe(e, r, "", "", function(e) {
			return t.call(n, e, i++);
		}), r;
	}
	function ce(e) {
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
	var le = typeof reportError == "function" ? reportError : function(e) {
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
	function ue(e) {
		var t = T.T, n = {};
		n.types = t === null ? null : t.types, T.T = n;
		try {
			var r = e(), i = T.S;
			i !== null && i(n, r), typeof r == "object" && r && typeof r.then == "function" && r.then(w, le);
		} catch (e) {
			le(e);
		} finally {
			t !== null && n.types !== null && (t.types = n.types), T.T = t;
		}
	}
	function de(e) {
		var t = T.T;
		if (t !== null) {
			var n = t.types;
			n === null ? t.types = [e] : n.indexOf(e) === -1 && n.push(e);
		} else ue(de.bind(null, e));
	}
	var fe = {
		map: se,
		forEach: function(e, t, n) {
			se(e, function() {
				t.apply(this, arguments);
			}, n);
		},
		count: function(e) {
			var t = 0;
			return se(e, function() {
				t++;
			}), t;
		},
		toArray: function(e) {
			return se(e, function(e) {
				return e;
			}) || [];
		},
		only: function(e) {
			if (!ne(e)) throw Error("React.Children.only expected to receive a single React element child.");
			return e;
		}
	};
	e.Activity = f, e.Children = fe, e.Component = y, e.Fragment = r, e.Profiler = a, e.PureComponent = x, e.StrictMode = i, e.Suspense = l, e.ViewTransition = p, e.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = T, e.__COMPILER_RUNTIME = {
		__proto__: null,
		c: function(e) {
			return T.H.useMemoCache(e);
		}
	}, e.addTransitionType = de, e.cache = function(e) {
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
	}, e.isValidElement = ne, e.lazy = function(e) {
		return {
			$$typeof: d,
			_payload: {
				_status: -1,
				_result: e
			},
			_init: ce
		};
	}, e.memo = function(e, t) {
		return {
			$$typeof: u,
			type: e,
			compare: t === void 0 ? null : t
		};
	}, e.startTransition = ue, e.unstable_useCacheRefresh = function() {
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
				t !== null && re(x, t.startTime - e);
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
								u !== null && re(x, u.startTime - t), i = !1;
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
		var ne = new MessageChannel(), D = ne.port2;
		ne.port1.onmessage = E, te = function() {
			D.postMessage(null);
		};
	} else te = function() {
		_(E, 0);
	};
	function re(t, n) {
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
		}, a > o ? (r.sortIndex = a, t(l, r), n(c) === null && r === n(l) && (h ? (v(C), C = -1) : h = !0, re(x, a - o))) : (r.sortIndex = s, t(c, r), m || p || (m = !0, S || (S = !0, te()))), r;
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
	var E = Object.assign, te = Symbol.for("react.element"), ne = Symbol.for("react.transitional.element"), D = Symbol.for("react.portal"), re = Symbol.for("react.fragment"), ie = Symbol.for("react.strict_mode"), ae = Symbol.for("react.profiler"), oe = Symbol.for("react.consumer"), se = Symbol.for("react.context"), ce = Symbol.for("react.forward_ref"), le = Symbol.for("react.suspense"), ue = Symbol.for("react.suspense_list"), de = Symbol.for("react.memo"), fe = Symbol.for("react.lazy"), pe = Symbol.for("react.activity"), me = Symbol.for("react.legacy_hidden"), he = Symbol.for("react.memo_cache_sentinel"), ge = Symbol.for("react.view_transition"), _e = Symbol.for("react.recoverable"), ve = Symbol.iterator;
	function ye(e) {
		return typeof e != "object" || !e ? null : (e = ve && e[ve] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var be = Symbol.for("react.client.reference");
	function xe(e) {
		if (e == null) return null;
		if (typeof e == "function") return e.$$typeof === be ? null : e.displayName || e.name || null;
		if (typeof e == "string") return e;
		switch (e) {
			case re: return "Fragment";
			case ae: return "Profiler";
			case ie: return "StrictMode";
			case le: return "Suspense";
			case ue: return "SuspenseList";
			case pe: return "Activity";
			case ge: return "ViewTransition";
		}
		if (typeof e == "object") switch (e.$$typeof) {
			case D: return "Portal";
			case se: return e.displayName || "Context";
			case oe: return (e._context.displayName || "Context") + ".Consumer";
			case ce:
				var t = e.render;
				return e = e.displayName, e ||= (e = t.displayName || t.name || "", e === "" ? "ForwardRef" : "ForwardRef(" + e + ")"), e;
			case de: return t = e.displayName || null, t === null ? xe(e.type) || "Memo" : t;
			case fe:
				t = e._payload, e = e._init;
				try {
					return xe(e(t));
				} catch {}
		}
		return null;
	}
	var Se = Array.isArray, O = n.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, k = r.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, Ce = {
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
				e = (e = t.documentElement) && (e = e.namespaceURI) ? xp(e) : 0;
				break;
			default: if (e = t.tagName, t = t.namespaceURI) t = xp(t), e = Sp(t, e);
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
	function A(e) {
		var t = e.memoizedState;
		t !== null && (gh._currentValue = t.memoizedState, Oe(Me, e)), t = ke.current;
		var n = Sp(t, e.type);
		t !== n && (Oe(Ae, e), Oe(ke, n));
	}
	function Fe(e) {
		Ae.current === e && (De(ke), De(Ae)), Me.current === e && (De(Me), gh._currentValue = Ce);
	}
	var Ie, Le;
	function Re(e) {
		if (Ie === void 0) try {
			throw Error();
		} catch (e) {
			var t = e.stack.trim().match(/\n( *(at )?)/);
			Ie = t && t[1] || "", Le = -1 < e.stack.indexOf("\n    at") ? " (<anonymous>)" : -1 < e.stack.indexOf("@") ? "@unknown:0:0" : "";
		}
		return "\n" + Ie + e + Le;
	}
	var ze = !1;
	function Be(e, t) {
		if (!e || ze) return "";
		ze = !0;
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
			ze = !1, Error.prepareStackTrace = n;
		}
		return (n = e ? e.displayName || e.name : "") ? Re(n) : "";
	}
	function Ve(e, t) {
		switch (e.tag) {
			case 26:
			case 27:
			case 5: return Re(e.type);
			case 16: return Re("Lazy");
			case 13: return e.child !== t && t !== null ? Re("Suspense Fallback") : Re("Suspense");
			case 19: return Re("SuspenseList");
			case 0:
			case 15: return Be(e.type, !1);
			case 11: return Be(e.type.render, !1);
			case 1: return Be(e.type, !0);
			case 31: return Re("Activity");
			case 30: return Re("ViewTransition");
			default: return "";
		}
	}
	function He(e) {
		try {
			var t = "", n = null;
			do
				t += Ve(e, n), n = e, e = e.return;
			while (e);
			return t;
		} catch (e) {
			return "\nError generating stack: " + e.message + "\n" + e.stack;
		}
	}
	var Ue = Object.prototype.hasOwnProperty, We = t.unstable_scheduleCallback, Ge = t.unstable_cancelCallback, Ke = t.unstable_shouldYield, qe = t.unstable_requestPaint, Je = t.unstable_now, Ye = t.unstable_getCurrentPriorityLevel, Xe = t.unstable_ImmediatePriority, Ze = t.unstable_UserBlockingPriority, Qe = t.unstable_NormalPriority, $e = t.unstable_LowPriority, et = t.unstable_IdlePriority, tt = t.log, nt = t.unstable_setDisableYieldValue, rt = null, it = null;
	function at(e) {
		if (typeof tt == "function" && nt(e), it && typeof it.setStrictMode == "function") try {
			it.setStrictMode(rt, e);
		} catch {}
	}
	var ot = Math.clz32 ? Math.clz32 : lt, st = Math.log, ct = Math.LN2;
	function lt(e) {
		return e >>>= 0, e === 0 ? 32 : 31 - (st(e) / ct | 0) | 0;
	}
	var ut = 256, dt = 262144, ft = 4194304;
	function pt(e) {
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
	function mt(e, t, n) {
		var r = e.pendingLanes;
		if (r === 0) return 0;
		var i = 0, a = e.suspendedLanes, o = e.pingedLanes;
		e = e.warmLanes;
		var s = r & 134217727;
		return s === 0 ? (s = r & ~a, s === 0 ? o === 0 ? n || (n = r & ~e, n !== 0 && (i = pt(n))) : i = pt(o) : i = pt(s)) : (r = s & ~a, r === 0 ? (o &= s, o === 0 ? n || (n = s & ~e, n !== 0 && (i = pt(n))) : i = pt(o)) : i = pt(r)), i === 0 ? 0 : t !== 0 && t !== i && (t & a) === 0 && (a = i & -i, n = t & -t, a >= n || a === 32 && n & 4194048) ? t : i;
	}
	function ht(e, t) {
		return (e.pendingLanes & ~(e.suspendedLanes & ~e.pingedLanes) & t) === 0;
	}
	function gt(e, t) {
		t & 8 && (t |= t & 32);
		var n = e.entangledLanes;
		if (n !== 0) for (e = e.entanglements, n &= t; 0 < n;) {
			var r = 31 - ot(n), i = 1 << r;
			t |= e[r], n &= ~i;
		}
		return t;
	}
	function _t(e, t) {
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
	function vt() {
		var e = ft;
		return ft <<= 1, !(ft & 62914560) && (ft = 4194304), e;
	}
	function yt(e) {
		for (var t = [], n = 0; 31 > n; n++) t.push(e);
		return t;
	}
	function bt(e, t) {
		e.pendingLanes |= t, t !== 268435456 && (e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0);
	}
	function xt(e, t, n, r, i, a) {
		var o = e.pendingLanes;
		e.pendingLanes = n, e.suspendedLanes = 0, e.pingedLanes = 0, e.warmLanes = 0, e.expiredLanes &= n, e.entangledLanes &= n, e.errorRecoveryDisabledLanes &= n, e.shellSuspendCounter = 0;
		var s = e.entanglements, c = e.expirationTimes, l = e.hiddenUpdates;
		for (n = o & ~n; 0 < n;) {
			var u = 31 - ot(n), d = 1 << u;
			s[u] = 0, c[u] = -1;
			var f = l[u];
			if (f !== null) for (l[u] = null, u = 0; u < f.length; u++) {
				var p = f[u];
				p !== null && (p.lane &= -536870913);
			}
			n &= ~d;
		}
		r !== 0 && St(e, r, 0), a !== 0 && i === 0 && e.tag !== 0 && (e.suspendedLanes |= a & ~(o & ~t));
	}
	function St(e, t, n) {
		e.pendingLanes |= t, e.suspendedLanes &= ~t;
		var r = 31 - ot(t);
		e.entangledLanes |= t, e.entanglements[r] = e.entanglements[r] | 1073741824 | n & 261930;
	}
	function Ct(e, t) {
		var n = e.entangledLanes |= t;
		for (e = e.entanglements; n;) {
			var r = 31 - ot(n), i = 1 << r;
			i & t | e[r] & t && (e[r] |= t), n &= ~i;
		}
	}
	function wt(e, t) {
		var n = t & -t;
		return n = n & 42 ? 1 : Tt(n), (n & (e.suspendedLanes | t)) === 0 ? n : 0;
	}
	function Tt(e) {
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
	function Et(e) {
		return e &= -e, 2 < e ? 8 < e ? e & 134217727 ? 32 : 268435456 : 8 : 2;
	}
	function Dt() {
		var e = k.p;
		return e === 0 ? (e = window.event, e === void 0 ? 32 : Mh(e.type)) : e;
	}
	function Ot(e, t) {
		var n = k.p;
		try {
			return k.p = e, t();
		} finally {
			k.p = n;
		}
	}
	var kt = Math.random().toString(36).slice(2), At = "__reactFiber$" + kt, jt = "__reactProps$" + kt, Mt = "__reactContainer$" + kt, Nt = "__reactEvents$" + kt, Pt = "__reactListeners$" + kt, Ft = "__reactHandles$" + kt, It = "__reactResources$" + kt, Lt = "__reactMarker$" + kt, Rt = "__reactLoad$" + kt;
	function zt(e) {
		delete e[At], delete e[jt], delete e[Pt], delete e[Ft];
	}
	function Bt(e) {
		var t;
		if (t = e[At]) return t;
		for (var n = e.parentNode; n;) {
			if (t = n[Mt] || n[At]) {
				if (n = t.alternate, t.child !== null || n !== null && n.child !== null) for (e = Cm(e); e !== null;) {
					if (n = e[At]) return n;
					e = Cm(e);
				}
				return t;
			}
			e = n, n = e.parentNode;
		}
		return null;
	}
	function Vt(e) {
		if (e = e[At] || e[Mt]) {
			var t = e.tag;
			if (t === 5 || t === 6 || t === 13 || t === 31 || t === 26 || t === 27 || t === 3) return e;
		}
		return null;
	}
	function Ht(e) {
		var t = e.tag;
		if (t === 5 || t === 26 || t === 27 || t === 6) return e.stateNode;
		throw Error(i(33));
	}
	function Ut(e) {
		var t = e[It];
		return t ||= e[It] = {
			hoistableStyles: /* @__PURE__ */ new Map(),
			hoistableScripts: /* @__PURE__ */ new Map()
		}, t;
	}
	function Wt(e) {
		e[Lt] = !0;
	}
	function Gt(e) {
		e[Rt] = void 0;
	}
	var Kt = /* @__PURE__ */ new Set(), qt = {};
	function Jt(e, t) {
		Yt(e, t), Yt(e + "Capture", t);
	}
	function Yt(e, t) {
		for (qt[e] = t, e = 0; e < t.length; e++) Kt.add(t[e]);
	}
	var Xt = RegExp("^[:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD][:A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*$"), Zt = {}, Qt = {};
	function $t(e) {
		return Ue.call(Qt, e) ? !0 : Ue.call(Zt, e) ? !1 : Xt.test(e) ? Qt[e] = !0 : (Zt[e] = !0, !1);
	}
	var en = !1;
	function tn() {
		var e = en;
		return en = !1, e;
	}
	function nn(e, t, n) {
		if ($t(t)) {
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
	function rn(e, t, n) {
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
	function an(e, t, n, r) {
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
	function on(e) {
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
	function sn(e) {
		var t = e.type;
		return (e = e.nodeName) && e.toLowerCase() === "input" && (t === "checkbox" || t === "radio");
	}
	function j(e, t, n) {
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
	function cn(e) {
		if (!e._valueTracker) {
			var t = sn(e) ? "checked" : "value";
			e._valueTracker = j(e, t, "" + e[t]);
		}
	}
	function ln(e) {
		if (!e) return !1;
		var t = e._valueTracker;
		if (!t) return !0;
		var n = t.getValue(), r = "";
		return e && (r = sn(e) ? e.checked ? "true" : "false" : e.value), e = r, e !== n && (t.setValue(e), !0);
	}
	var un = /[\n"\\]/g;
	function dn(e) {
		return e.replace(un, function(e) {
			return "\\" + e.charCodeAt(0).toString(16) + " ";
		});
	}
	function fn(e, t, n, r, i, a, o, s) {
		e.name = "", o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" ? e.type = o : e.removeAttribute("type"), t == null ? o !== "submit" && o !== "reset" || e.removeAttribute("value") : o === "number" ? (t === 0 && e.value === "" || e.value != t) && (e.value = "" + on(t)) : e.value !== "" + on(t) && (e.value = "" + on(t)), t == null ? n == null ? r != null && e.removeAttribute("value") : mn(e, on(n)) : o === "number" && e.value == t ? mn(e, on(e.value)) : mn(e, on(t)), i == null && a != null && (e.defaultChecked = !!a), i != null && (e.checked = i && typeof i != "function" && typeof i != "symbol"), s != null && typeof s != "function" && typeof s != "symbol" && typeof s != "boolean" ? e.name = "" + on(s) : e.removeAttribute("name");
	}
	function pn(e, t, n, r, i, a, o, s) {
		if (a != null && typeof a != "function" && typeof a != "symbol" && typeof a != "boolean" && (e.type = a), t != null || n != null) {
			if (!(a !== "submit" && a !== "reset" || t != null)) {
				cn(e);
				return;
			}
			n = n == null ? "" : "" + on(n), t = t == null ? n : "" + on(t), s || t === e.value || (e.value = t), e.defaultValue = t;
		}
		r ??= i, r = typeof r != "function" && typeof r != "symbol" && !!r, e.checked = s ? e.checked : !!r, e.defaultChecked = !!r, o != null && typeof o != "function" && typeof o != "symbol" && typeof o != "boolean" && (e.name = o), cn(e);
	}
	function mn(e, t) {
		e.defaultValue !== "" + t && (e.defaultValue = "" + t);
	}
	function hn(e, t, n, r) {
		if (e = e.options, t) {
			t = {};
			for (var i = 0; i < n.length; i++) t["$" + n[i]] = !0;
			for (n = 0; n < e.length; n++) i = t.hasOwnProperty("$" + e[n].value), e[n].selected !== i && (e[n].selected = i), i && r && (e[n].defaultSelected = !0);
		} else {
			for (n = "" + on(n), t = null, i = 0; i < e.length; i++) {
				if (e[i].value === n) {
					e[i].selected = !0, r && (e[i].defaultSelected = !0);
					return;
				}
				t !== null || e[i].disabled || (t = e[i]);
			}
			t !== null && (t.selected = !0);
		}
	}
	function gn(e, t, n) {
		if (t != null && (t = "" + on(t), t !== e.value && (e.value = t), n == null)) {
			e.defaultValue !== t && (e.defaultValue = t);
			return;
		}
		e.defaultValue = n == null ? "" : "" + on(n);
	}
	function _n(e, t, n, r) {
		if (t == null) {
			if (r != null) {
				if (n != null) throw Error(i(92));
				if (Se(r)) {
					if (1 < r.length) throw Error(i(93));
					r = r[0];
				}
				n = r;
			}
			n ??= "", t = n;
		}
		n = on(t), e.defaultValue = n, r = e.textContent, r === n && r !== "" && r !== null && (e.value = r), cn(e);
	}
	function vn(e, t) {
		if (t) {
			var n = e.firstChild;
			if (n && n === e.lastChild && n.nodeType === 3) {
				n.nodeValue = t;
				return;
			}
		}
		e.textContent = t;
	}
	var yn = new Set("animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth boxFlex boxFlexGroup boxOrdinalGroup columnCount columns flex flexGrow flexPositive flexShrink flexNegative flexOrder gridArea gridRow gridRowEnd gridRowSpan gridRowStart gridColumn gridColumnEnd gridColumnSpan gridColumnStart fontWeight lineClamp lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity floodOpacity stopOpacity strokeDasharray strokeDashoffset strokeMiterlimit strokeOpacity strokeWidth MozAnimationIterationCount MozBoxFlex MozBoxFlexGroup MozLineClamp msAnimationIterationCount msFlex msZoom msFlexGrow msFlexNegative msFlexOrder msFlexPositive msFlexShrink msGridColumn msGridColumnSpan msGridRow msGridRowSpan WebkitAnimationIterationCount WebkitBoxFlex WebKitBoxFlexGroup WebkitBoxOrdinalGroup WebkitColumnCount WebkitColumns WebkitFlex WebkitFlexGrow WebkitFlexPositive WebkitFlexShrink WebkitLineClamp".split(" "));
	function bn(e, t, n) {
		var r = t.indexOf("--") === 0;
		n == null || typeof n == "boolean" || n === "" ? r ? e.setProperty(t, "") : t === "float" ? e.cssFloat = "" : e[t] = "" : r ? e.setProperty(t, n) : typeof n != "number" || n === 0 || yn.has(t) ? t === "float" ? e.cssFloat = n : e[t] = ("" + n).trim() : e[t] = n + "px";
	}
	function xn(e, t, n) {
		if (t != null && typeof t != "object") throw Error(i(62));
		if (e = e.style, n != null) {
			for (var r in n) !n.hasOwnProperty(r) || t != null && t.hasOwnProperty(r) || (r.indexOf("--") === 0 ? e.setProperty(r, "") : r === "float" ? e.cssFloat = "" : e[r] = "", en = !0);
			for (var a in t) r = t[a], t.hasOwnProperty(a) && n[a] !== r && (bn(e, a, r), en = !0);
		} else for (var o in t) t.hasOwnProperty(o) && bn(e, o, t[o]);
	}
	function Sn(e) {
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
	var Cn = /* @__PURE__ */ new Map([
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
	]), wn = /^[\u0000-\u001F ]*j[\r\n\t]*a[\r\n\t]*v[\r\n\t]*a[\r\n\t]*s[\r\n\t]*c[\r\n\t]*r[\r\n\t]*i[\r\n\t]*p[\r\n\t]*t[\r\n\t]*:/i;
	function Tn(e) {
		return wn.test("" + e) ? "javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')" : e;
	}
	function En() {}
	var Dn = null;
	function On(e) {
		return e = e.target || e.srcElement || window, e.correspondingUseElement && (e = e.correspondingUseElement), e.nodeType === 3 ? e.parentNode : e;
	}
	var kn = null, An = null;
	function jn(e) {
		var t = Vt(e);
		if (t && (e = t.stateNode)) {
			var n = e[jt] || null;
			a: switch (e = t.stateNode, t.type) {
				case "input":
					if (fn(e, n.value, n.defaultValue, n.defaultValue, n.checked, n.defaultChecked, n.type, n.name), t = n.name, n.type === "radio" && t != null) {
						for (n = e; n.parentNode;) n = n.parentNode;
						for (n = n.querySelectorAll("input[name=\"" + dn("" + t) + "\"][type=\"radio\"]"), t = 0; t < n.length; t++) {
							var r = n[t];
							if (r !== e && r.form === e.form) {
								var a = r[jt] || null;
								if (!a) throw Error(i(90));
								fn(r, a.value, a.defaultValue, a.defaultValue, a.checked, a.defaultChecked, a.type, a.name);
							}
						}
						for (t = 0; t < n.length; t++) r = n[t], r.form === e.form && ln(r);
					}
					break a;
				case "textarea":
					gn(e, n.value, n.defaultValue);
					break a;
				case "select": t = n.value, t != null && hn(e, !!n.multiple, t, !1);
			}
		}
	}
	var Mn = !1;
	function Nn(e, t, n) {
		if (Mn) return e(t, n);
		Mn = !0;
		try {
			return e(t);
		} finally {
			if (Mn = !1, (kn !== null || An !== null) && (Jd(), kn && (t = kn, e = An, An = kn = null, jn(t), e))) for (t = 0; t < e.length; t++) jn(e[t]);
		}
	}
	function Pn(e, t) {
		var n = e.stateNode;
		if (n === null) return null;
		var r = n[jt] || null;
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
	var Fn = typeof window < "u" && window.document !== void 0 && window.document.createElement !== void 0, M = !1;
	if (Fn) try {
		var In = {};
		Object.defineProperty(In, "passive", { get: function() {
			M = !0;
		} }), window.addEventListener("test", In, In), window.removeEventListener("test", In, In);
	} catch {
		M = !1;
	}
	var Ln = null, Rn = null, zn = null;
	function Bn() {
		if (zn) return zn;
		var e, t = Rn, n = t.length, r, i = "value" in Ln ? Ln.value : Ln.textContent, a = i.length;
		for (e = 0; e < n && t[e] === i[e]; e++);
		var o = n - e;
		for (r = 1; r <= o && t[n - r] === i[a - r]; r++);
		return zn = i.slice(e, 1 < r ? 1 - r : void 0);
	}
	function Vn(e) {
		var t = e.keyCode;
		return "charCode" in e ? (e = e.charCode, e === 0 && t === 13 && (e = 13)) : e = t, e === 10 && (e = 13), 32 <= e || e === 13 ? e : 0;
	}
	function Hn() {
		return !0;
	}
	function Un() {
		return !1;
	}
	function Wn(e) {
		function t(t, n, r, i, a) {
			for (var o in this._reactName = t, this._targetInst = r, this.type = n, this.nativeEvent = i, this.target = a, this.currentTarget = null, e) e.hasOwnProperty(o) && (t = e[o], this[o] = t ? t(i) : i[o]);
			return this.isDefaultPrevented = (i.defaultPrevented == null ? !1 === i.returnValue : i.defaultPrevented) ? Hn : Un, this.isPropagationStopped = Un, this;
		}
		return E(t.prototype, {
			preventDefault: function() {
				this.defaultPrevented = !0;
				var e = this.nativeEvent;
				e && (e.preventDefault ? e.preventDefault() : typeof e.returnValue != "unknown" && (e.returnValue = !1), this.isDefaultPrevented = Hn);
			},
			stopPropagation: function() {
				var e = this.nativeEvent;
				e && (e.stopPropagation ? e.stopPropagation() : typeof e.cancelBubble != "unknown" && (e.cancelBubble = !0), this.isPropagationStopped = Hn);
			},
			persist: function() {},
			isPersistent: Hn
		}), t;
	}
	var Gn = {
		eventPhase: 0,
		bubbles: 0,
		cancelable: 0,
		timeStamp: function(e) {
			return e.timeStamp || Date.now();
		},
		defaultPrevented: 0,
		isTrusted: 0
	}, N = Wn(Gn), Kn = E({}, Gn, {
		view: 0,
		detail: 0
	}), qn = Wn(Kn), Jn, Yn, Xn, Zn = E({}, Kn, {
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
		getModifierState: cr,
		button: 0,
		buttons: 0,
		relatedTarget: function(e) {
			return e.relatedTarget === void 0 ? e.fromElement === e.srcElement ? e.toElement : e.fromElement : e.relatedTarget;
		},
		movementX: function(e) {
			return "movementX" in e ? e.movementX : (e !== Xn && (Xn && e.type === "mousemove" ? (Jn = e.screenX - Xn.screenX, Yn = e.screenY - Xn.screenY) : Yn = Jn = 0, Xn = e), Jn);
		},
		movementY: function(e) {
			return "movementY" in e ? e.movementY : Yn;
		}
	}), Qn = Wn(Zn), $n = Wn(E({}, Zn, { dataTransfer: 0 })), er = Wn(E({}, Kn, { relatedTarget: 0 })), tr = Wn(E({}, Gn, {
		animationName: 0,
		elapsedTime: 0,
		pseudoElement: 0
	})), nr = Wn(E({}, Gn, { clipboardData: function(e) {
		return "clipboardData" in e ? e.clipboardData : window.clipboardData;
	} })), rr = Wn(E({}, Gn, { data: 0 })), ir = {
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
	}, ar = {
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
	}, or = {
		Alt: "altKey",
		Control: "ctrlKey",
		Meta: "metaKey",
		Shift: "shiftKey"
	};
	function sr(e) {
		var t = this.nativeEvent;
		return t.getModifierState ? t.getModifierState(e) : (e = or[e]) ? !!t[e] : !1;
	}
	function cr() {
		return sr;
	}
	var lr = Wn(E({}, Kn, {
		key: function(e) {
			if (e.key) {
				var t = ir[e.key] || e.key;
				if (t !== "Unidentified") return t;
			}
			return e.type === "keypress" ? (e = Vn(e), e === 13 ? "Enter" : String.fromCharCode(e)) : e.type === "keydown" || e.type === "keyup" ? ar[e.keyCode] || "Unidentified" : "";
		},
		code: 0,
		location: 0,
		ctrlKey: 0,
		shiftKey: 0,
		altKey: 0,
		metaKey: 0,
		repeat: 0,
		locale: 0,
		getModifierState: cr,
		charCode: function(e) {
			return e.type === "keypress" ? Vn(e) : 0;
		},
		keyCode: function(e) {
			return e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
		},
		which: function(e) {
			return e.type === "keypress" ? Vn(e) : e.type === "keydown" || e.type === "keyup" ? e.keyCode : 0;
		}
	})), ur = Wn(E({}, Zn, {
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
	})), dr = Wn(E({}, Gn, { submitter: 0 })), fr = Wn(E({}, Kn, {
		touches: 0,
		targetTouches: 0,
		changedTouches: 0,
		altKey: 0,
		metaKey: 0,
		ctrlKey: 0,
		shiftKey: 0,
		getModifierState: cr
	})), pr = Wn(E({}, Gn, {
		propertyName: 0,
		elapsedTime: 0,
		pseudoElement: 0
	})), mr = Wn(E({}, Zn, {
		deltaX: function(e) {
			return "deltaX" in e ? e.deltaX : "wheelDeltaX" in e ? -e.wheelDeltaX : 0;
		},
		deltaY: function(e) {
			return "deltaY" in e ? e.deltaY : "wheelDeltaY" in e ? -e.wheelDeltaY : "wheelDelta" in e ? -e.wheelDelta : 0;
		},
		deltaZ: 0,
		deltaMode: 0
	})), hr = Wn(E({}, Gn, {
		newState: 0,
		oldState: 0,
		source: 0
	})), gr = [
		9,
		13,
		27,
		32
	], _r = Fn && "CompositionEvent" in window, vr = null;
	Fn && "documentMode" in document && (vr = document.documentMode);
	var yr = Fn && "TextEvent" in window && !vr, br = Fn && (!_r || vr && 8 < vr && 11 >= vr), xr = " ", Sr = !1;
	function Cr(e, t) {
		switch (e) {
			case "keyup": return gr.indexOf(t.keyCode) !== -1;
			case "keydown": return t.keyCode !== 229;
			case "keypress":
			case "mousedown":
			case "focusout": return !0;
			default: return !1;
		}
	}
	function wr(e) {
		return e = e.detail, typeof e == "object" && "data" in e ? e.data : null;
	}
	var Tr = !1;
	function Er(e, t) {
		switch (e) {
			case "compositionend": return wr(t);
			case "keypress": return t.which === 32 ? (Sr = !0, xr) : null;
			case "textInput": return e = t.data, e === xr && Sr ? null : e;
			default: return null;
		}
	}
	function Dr(e, t) {
		if (Tr) return e === "compositionend" || !_r && Cr(e, t) ? (e = Bn(), zn = Rn = Ln = null, Tr = !1, e) : null;
		switch (e) {
			case "paste": return null;
			case "keypress":
				if (!(t.ctrlKey || t.altKey || t.metaKey) || t.ctrlKey && t.altKey) {
					if (t.char && 1 < t.char.length) return t.char;
					if (t.which) return String.fromCharCode(t.which);
				}
				return null;
			case "compositionend": return br && t.locale !== "ko" ? null : t.data;
			default: return null;
		}
	}
	var Or = {
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
	function kr(e) {
		var t = e && e.nodeName && e.nodeName.toLowerCase();
		return t === "input" ? !!Or[e.type] : t === "textarea";
	}
	function Ar(e, t, n, r) {
		kn ? An ? An.push(r) : An = [r] : kn = r, t = ip(t, "onChange"), 0 < t.length && (n = new N("onChange", "change", null, n, r), e.push({
			event: n,
			listeners: t
		}));
	}
	var jr = null, P = null;
	function Mr(e) {
		Zf(e, 0);
	}
	function Nr(e) {
		if (ln(Ht(e))) return e;
	}
	function Pr(e, t) {
		if (e === "change") return t;
	}
	var Fr = !1;
	if (Fn) {
		var Ir;
		if (Fn) {
			var Lr = "oninput" in document;
			if (!Lr) {
				var Rr = document.createElement("div");
				Rr.setAttribute("oninput", "return;"), Lr = typeof Rr.oninput == "function";
			}
			Ir = Lr;
		} else Ir = !1;
		Fr = Ir && (!document.documentMode || 9 < document.documentMode);
	}
	function zr() {
		jr && (jr.detachEvent("onpropertychange", Br), P = jr = null);
	}
	function Br(e) {
		if (e.propertyName === "value" && Nr(P)) {
			var t = [];
			Ar(t, P, e, On(e)), Nn(Mr, t);
		}
	}
	function Vr(e, t, n) {
		e === "focusin" ? (zr(), jr = t, P = n, jr.attachEvent("onpropertychange", Br)) : e === "focusout" && zr();
	}
	function Hr(e) {
		if (e === "selectionchange" || e === "keyup" || e === "keydown") return Nr(P);
	}
	function Ur(e, t) {
		if (e === "click") return Nr(t);
	}
	function Wr(e, t) {
		if (e === "input" || e === "change") return Nr(t);
	}
	function Gr(e, t) {
		return e === t && (e !== 0 || 1 / e == 1 / t) || e !== e && t !== t;
	}
	var Kr = typeof Object.is == "function" ? Object.is : Gr;
	function qr(e, t) {
		if (Kr(e, t)) return !0;
		if (typeof e != "object" || !e || typeof t != "object" || !t) return !1;
		var n = Object.keys(e), r = Object.keys(t);
		if (n.length !== r.length) return !1;
		for (r = 0; r < n.length; r++) {
			var i = n[r];
			if (!Ue.call(t, i) || !Kr(e[i], t[i])) return !1;
		}
		return !0;
	}
	function Jr(e) {
		if (e ||= typeof document < "u" ? document : void 0, e === void 0) return null;
		try {
			return e.activeElement || e.body;
		} catch {
			return e.body;
		}
	}
	function Yr(e) {
		for (; e && e.firstChild;) e = e.firstChild;
		return e;
	}
	function Xr(e, t) {
		var n = Yr(e);
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
			n = Yr(n);
		}
	}
	function Zr(e, t) {
		return e && t ? e === t ? !0 : e && e.nodeType === 3 ? !1 : t && t.nodeType === 3 ? Zr(e, t.parentNode) : "contains" in e ? e.contains(t) : e.compareDocumentPosition ? !!(e.compareDocumentPosition(t) & 16) : !1 : !1;
	}
	function Qr(e) {
		e = e != null && e.ownerDocument != null && e.ownerDocument.defaultView != null ? e.ownerDocument.defaultView : window;
		for (var t = Jr(e.document); t instanceof e.HTMLIFrameElement;) {
			try {
				var n = typeof t.contentWindow.location.href == "string";
			} catch {
				n = !1;
			}
			if (n) e = t.contentWindow;
			else break;
			t = Jr(e.document);
		}
		return t;
	}
	function $r(e) {
		var t = e && e.nodeName && e.nodeName.toLowerCase();
		return t && (t === "input" && (e.type === "text" || e.type === "search" || e.type === "tel" || e.type === "url" || e.type === "password") || t === "textarea" || e.contentEditable === "true");
	}
	var ei = Fn && "documentMode" in document && 11 >= document.documentMode, ti = null, ni = null, ri = null, ii = !1;
	function ai(e, t, n) {
		var r = n.window === n ? n.document : n.nodeType === 9 ? n : n.ownerDocument;
		ii || ti == null || ti !== Jr(r) || (r = ti, "selectionStart" in r && $r(r) ? r = {
			start: r.selectionStart,
			end: r.selectionEnd
		} : (r = (r.ownerDocument && r.ownerDocument.defaultView || window).getSelection(), r = {
			anchorNode: r.anchorNode,
			anchorOffset: r.anchorOffset,
			focusNode: r.focusNode,
			focusOffset: r.focusOffset
		}), ri && qr(ri, r) || (ri = r, r = ip(ni, "onSelect"), 0 < r.length && (t = new N("onSelect", "select", null, t, n), e.push({
			event: t,
			listeners: r
		}), t.target = ti)));
	}
	function oi(e, t) {
		var n = {};
		return n[e.toLowerCase()] = t.toLowerCase(), n["Webkit" + e] = "webkit" + t, n["Moz" + e] = "moz" + t, n;
	}
	var si = {
		animationend: oi("Animation", "AnimationEnd"),
		animationiteration: oi("Animation", "AnimationIteration"),
		animationstart: oi("Animation", "AnimationStart"),
		transitionrun: oi("Transition", "TransitionRun"),
		transitionstart: oi("Transition", "TransitionStart"),
		transitioncancel: oi("Transition", "TransitionCancel"),
		transitionend: oi("Transition", "TransitionEnd")
	}, ci = {}, li = {};
	Fn && (li = document.createElement("div").style, "AnimationEvent" in window || (delete si.animationend.animation, delete si.animationiteration.animation, delete si.animationstart.animation), "TransitionEvent" in window || delete si.transitionend.transition);
	function ui(e) {
		if (ci[e]) return ci[e];
		if (!si[e]) return e;
		var t = si[e], n;
		for (n in t) if (t.hasOwnProperty(n) && n in li) return ci[e] = t[n];
		return e;
	}
	var di = ui("animationend"), fi = ui("animationiteration"), pi = ui("animationstart"), mi = ui("transitionrun"), hi = ui("transitionstart"), gi = ui("transitioncancel"), _i = ui("transitionend"), vi = /* @__PURE__ */ new Map(), yi = "abort auxClick beforeToggle cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error fullscreenChange fullscreenError gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ");
	yi.push("scrollEnd");
	function bi(e, t) {
		vi.set(e, t), Jt(t, [e]);
	}
	var xi = 0;
	function Si(e, t) {
		if (e.name != null && e.name !== "auto") return e.name;
		if (t.autoName !== null) return t.autoName;
		e = kd.identifierPrefix;
		var n = xi++;
		return e = "_" + e + "t_" + n.toString(32) + "_", t.autoName = e;
	}
	function Ci(e) {
		if (e == null || typeof e == "string") return e;
		var t = null, n = Ld;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = e[n[r]];
			if (i != null) {
				if (i === "none") return "none";
				t = t == null ? i : t + (" " + i);
			}
		}
		return t ?? e.default;
	}
	function wi(e, t) {
		return e = Ci(e), t = Ci(t), t == null ? e === "auto" ? null : e : t === "auto" ? null : t;
	}
	var Ti = typeof reportError == "function" ? reportError : function(e) {
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
	}, Ei = [], Di = 0, Oi = 0;
	function ki() {
		for (var e = Di, t = Oi = Di = 0; t < e;) {
			var n = Ei[t];
			Ei[t++] = null;
			var r = Ei[t];
			Ei[t++] = null;
			var i = Ei[t];
			Ei[t++] = null;
			var a = Ei[t];
			if (Ei[t++] = null, r !== null && i !== null) {
				var o = r.pending;
				o === null ? i.next = i : (i.next = o.next, o.next = i), r.pending = i;
			}
			a !== 0 && Ni(n, i, a);
		}
	}
	function Ai(e, t, n, r) {
		Ei[Di++] = e, Ei[Di++] = t, Ei[Di++] = n, Ei[Di++] = r, Oi |= r, e.lanes |= r, e = e.alternate, e !== null && (e.lanes |= r);
	}
	function ji(e, t, n, r) {
		return Ai(e, t, n, r), Pi(e);
	}
	function Mi(e, t) {
		return Ai(e, null, null, t), Pi(e);
	}
	function Ni(e, t, n) {
		e.lanes |= n;
		var r = e.alternate;
		r !== null && (r.lanes |= n);
		for (var i = !1, a = e.return; a !== null;) a.childLanes |= n, r = a.alternate, r !== null && (r.childLanes |= n), a.tag === 22 && (e = a.stateNode, e === null || e._visibility & 1 || (i = !0)), e = a, a = a.return;
		return e.tag === 3 ? (a = e.stateNode, i && t !== null && (i = 31 - ot(n), e = a.hiddenUpdates, r = e[i], r === null ? e[i] = [t] : r.push(t), t.lane = n | 536870912), a) : null;
	}
	function Pi(e) {
		if (50 < Rd) throw Rd = 0, zd = null, Error(i(185));
		for (var t = e.return; t !== null;) e = t, t = e.return;
		return e.tag === 3 ? e.stateNode : null;
	}
	var Fi = {};
	function Ii(e, t, n, r) {
		this.tag = e, this.key = n, this.sibling = this.child = this.return = this.stateNode = this.type = this.elementType = null, this.index = 0, this.refCleanup = this.ref = null, this.pendingProps = t, this.dependencies = this.memoizedState = this.updateQueue = this.memoizedProps = null, this.mode = r, this.subtreeFlags = this.flags = 0, this.deletions = null, this.childLanes = this.lanes = 0, this.alternate = null;
	}
	function Li(e, t, n, r) {
		return new Ii(e, t, n, r);
	}
	function Ri(e) {
		return e = e.prototype, !(!e || !e.isReactComponent);
	}
	function zi(e, t) {
		var n = e.alternate;
		return n === null ? (n = Li(e.tag, t, e.key, e.mode), n.elementType = e.elementType, n.type = e.type, n.stateNode = e.stateNode, n.alternate = e, e.alternate = n) : (n.pendingProps = t, n.type = e.type, n.flags = 0, n.subtreeFlags = 0, n.deletions = null), n.flags = e.flags & 1206910976, n.childLanes = e.childLanes, n.lanes = e.lanes, n.child = e.child, n.memoizedProps = e.memoizedProps, n.memoizedState = e.memoizedState, n.updateQueue = e.updateQueue, t = e.dependencies, n.dependencies = t === null ? null : {
			lanes: t.lanes,
			firstContext: t.firstContext
		}, n.sibling = e.sibling, n.index = e.index, n.ref = e.ref, n.refCleanup = e.refCleanup, n;
	}
	function Bi(e, t) {
		e.flags &= 1206910978;
		var n = e.alternate;
		return n === null ? (e.childLanes = 0, e.lanes = t, e.child = null, e.subtreeFlags = 0, e.memoizedProps = null, e.memoizedState = null, e.updateQueue = null, e.dependencies = null, e.stateNode = null) : (e.childLanes = n.childLanes, e.lanes = n.lanes, e.child = n.child, e.subtreeFlags = 0, e.deletions = null, e.memoizedProps = n.memoizedProps, e.memoizedState = n.memoizedState, e.updateQueue = n.updateQueue, e.type = n.type, t = n.dependencies, e.dependencies = t === null ? null : {
			lanes: t.lanes,
			firstContext: t.firstContext
		}), e;
	}
	function Vi(e, t, n, r, a, o) {
		var s = 0;
		if (r = e, typeof r == "function") Ri(r) && (s = 1);
		else if (typeof r == "string") s = nh(e, n, ke.current) ? 26 : e === "html" || e === "head" || e === "body" ? 27 : 5;
		else a: switch (r) {
			case pe: return e = Li(31, n, t, a), e.elementType = pe, e.lanes = o, e;
			case re: return Hi(n.children, a, o, t);
			case ie:
				s = 8, a |= 24;
				break;
			case ae: return e = Li(12, n, t, a | 2), e.elementType = ae, e.lanes = o, e;
			case le: return e = Li(13, n, t, a), e.elementType = le, e.lanes = o, e;
			case ue: return e = Li(19, n, t, a), e.elementType = ue, e.lanes = o, e;
			case me:
			case ge: return e = a | 32, e = Li(30, n, t, e), e.elementType = ge, e.lanes = o, e.stateNode = {
				autoName: null,
				paired: null,
				clones: null,
				ref: null
			}, e;
			default:
				if (typeof r == "object" && r) switch (r.$$typeof) {
					case se:
						s = 10;
						break a;
					case oe:
						s = 9;
						break a;
					case ce:
						s = 11;
						break a;
					case de:
						s = 14;
						break a;
					case fe:
						s = 16, r = null;
						break a;
				}
				s = 29, n = Error(i(130, e === null ? "null" : typeof e, "")), r = null;
		}
		return t = Li(s, n, t, a), t.elementType = e, t.type = r, t.lanes = o, t;
	}
	function Hi(e, t, n, r) {
		return e = Li(7, e, r, t), e.lanes = n, e;
	}
	function Ui(e, t, n) {
		return e = Li(6, e, null, t), e.lanes = n, e;
	}
	function Wi(e) {
		var t = Li(18, null, null, 0);
		return t.stateNode = e, t;
	}
	function Gi(e, t, n) {
		return t = Li(4, e.children === null ? [] : e.children, e.key, t), t.lanes = n, t.stateNode = {
			containerInfo: e.containerInfo,
			pendingChildren: null,
			implementation: e.implementation
		}, t;
	}
	var Ki = /* @__PURE__ */ new WeakMap();
	function F(e, t) {
		if (typeof e == "object" && e) {
			var n = Ki.get(e);
			return n === void 0 ? (t = {
				value: e,
				source: t,
				stack: He(t)
			}, Ki.set(e, t), t) : n;
		}
		return {
			value: e,
			source: t,
			stack: He(t)
		};
	}
	var qi = [], Ji = 0, Yi = null, Xi = 0, Zi = [], Qi = 0, $i = null, ea = 1, ta = "";
	function I(e, t) {
		qi[Ji++] = Xi, qi[Ji++] = Yi, Yi = e, Xi = t;
	}
	function na(e, t, n) {
		Zi[Qi++] = ea, Zi[Qi++] = ta, Zi[Qi++] = $i, $i = e;
		var r = ea;
		e = ta;
		var i = 32 - ot(r) - 1;
		r &= ~(1 << i), n += 1;
		var a = 32 - ot(t) + i;
		if (30 < a) {
			var o = i - i % 5;
			a = (r & (1 << o) - 1).toString(32), r >>= o, i -= o, ea = 1 << 32 - ot(t) + i | n << i | r, ta = a + e;
		} else ea = 1 << a | n << i | r, ta = e;
	}
	function L(e) {
		e.return !== null && (I(e, 1), na(e, 1, 0));
	}
	function ra(e) {
		for (; e === Yi;) Yi = qi[--Ji], qi[Ji] = null, Xi = qi[--Ji], qi[Ji] = null;
		for (; e === $i;) $i = Zi[--Qi], Zi[Qi] = null, ta = Zi[--Qi], Zi[Qi] = null, ea = Zi[--Qi], Zi[Qi] = null;
	}
	function ia(e, t) {
		Zi[Qi++] = ea, Zi[Qi++] = ta, Zi[Qi++] = $i, ea = t.id, ta = t.overflow, $i = e;
	}
	var aa = null, oa = null, R = !1, sa = null, ca = !1, la = Error(i(519));
	function ua(e) {
		throw ga(F(Error(i(418, 1 < arguments.length && arguments[1] !== void 0 && arguments[1] ? "text" : "HTML", "")), e)), la;
	}
	function da(e) {
		var t = e.stateNode, n = e.type, r = e.memoizedProps;
		switch (t[At] = e, t[jt] = r, n) {
			case "dialog":
				H("cancel", t), H("close", t);
				break;
			case "iframe":
			case "object":
			case "embed":
				H("load", t);
				break;
			case "video":
			case "audio":
				for (n = 0; n < Yf.length; n++) H(Yf[n], t);
				break;
			case "source":
				H("error", t);
				break;
			case "img":
			case "image":
			case "link":
				H("error", t), H("load", t);
				break;
			case "details":
				H("toggle", t);
				break;
			case "input":
				H("invalid", t), pn(t, r.value, r.defaultValue, r.checked, r.defaultChecked, r.type, r.name, !0);
				break;
			case "select":
				H("invalid", t);
				break;
			case "textarea": H("invalid", t), _n(t, r.value, r.defaultValue, r.children);
		}
		n = r.children, typeof n != "string" && typeof n != "number" && typeof n != "bigint" || t.textContent === "" + n || !0 === r.suppressHydrationWarning || up(t.textContent, n) ? (r.popover != null && (H("beforetoggle", t), H("toggle", t)), r.onScroll != null && H("scroll", t), r.onScrollEnd != null && H("scrollend", t), r.onClick != null && (t.onclick = En), t = !0) : t = !1, t || ua(e, !0);
	}
	function fa(e) {
		for (aa = e.return; aa;) switch (aa.tag) {
			case 5:
			case 31:
			case 13:
				ca = !1;
				return;
			case 27:
			case 3:
				ca = !0;
				return;
			default: aa = aa.return;
		}
	}
	function pa(e) {
		if (e !== aa) return !1;
		if (!R) return fa(e), R = !0, !1;
		var t = e.tag, n;
		if ((n = t !== 3 && t !== 27) && ((n = t === 5) && (n = e.type, n = n === "form" || n === "button" || wp(e.type, e.memoizedProps)), n = !n), n && oa && ua(e), fa(e), t === 13) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(i(317));
			oa = Sm(e);
		} else if (t === 31) {
			if (e = e.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(i(317));
			oa = Sm(e);
		} else t === 27 ? (t = oa, Np(e.type) ? (e = xm, xm = null, oa = e) : oa = t) : oa = aa ? bm(e.stateNode.nextSibling) : null;
		return !0;
	}
	function ma() {
		oa = aa = null, R = !1;
	}
	function ha() {
		var e = sa;
		return e !== null && (xd === null ? xd = e : xd.push.apply(xd, e), sa = null), e;
	}
	function ga(e) {
		sa === null ? sa = [e] : sa.push(e);
	}
	var _a = Ee(null), va = null, ya = null;
	function ba(e, t, n) {
		Oe(_a, t._currentValue), t._currentValue = n;
	}
	function xa(e) {
		e._currentValue = _a.current, De(_a);
	}
	function Sa(e, t, n) {
		for (; e !== null;) {
			var r = e.alternate;
			if ((e.childLanes & t) === t ? r !== null && (r.childLanes & t) !== t && (r.childLanes |= t) : (e.childLanes |= t, r !== null && (r.childLanes |= t)), e === n) break;
			e = e.return;
		}
	}
	function Ca(e, t, n, r) {
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
						o.lanes |= n, c = o.alternate, c !== null && (c.lanes |= n), Sa(o.return, n, e), r || (s = null);
						break a;
					}
					o = c.next;
				}
			} else if (a.tag === 18) {
				if (s = a.return, s === null) throw Error(i(341));
				s.lanes |= n, o = s.alternate, o !== null && (o.lanes |= n), Sa(s, n, e), s = null;
			} else a.tag === 13 && a.memoizedState !== null && a.memoizedState.dehydrated === null ? (a.lanes |= n, s = a.alternate, s !== null && (s.lanes |= n), Sa(a.return, n, e), s = a.child, s = s === null ? null : s.sibling) : s = a.child;
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
	function wa(e, t, n, r) {
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
					Kr(a.pendingProps.value, s.value) || (e === null ? e = [c] : e.push(c));
				}
			} else if (a === Me.current) {
				if (s = a.alternate, s === null) throw Error(i(387));
				s.memoizedState.memoizedState !== a.memoizedState.memoizedState && (e === null ? e = [gh] : e.push(gh));
			}
			a = a.return;
		}
		return e !== null && Ca(t, e, n, r), t.flags |= 262144, e !== null;
	}
	function Ta(e) {
		for (e = e.firstContext; e !== null;) {
			if (!Kr(e.context._currentValue, e.memoizedValue)) return !0;
			e = e.next;
		}
		return !1;
	}
	function Ea(e) {
		va = e, ya = null, e = e.dependencies, e !== null && (e.firstContext = null);
	}
	function Da(e) {
		return ka(va, e);
	}
	function Oa(e, t) {
		return va === null && Ea(e), ka(e, t);
	}
	function ka(e, t) {
		var n = t._currentValue;
		if (t = {
			context: t,
			memoizedValue: n,
			next: null
		}, ya === null) {
			if (e === null) throw Error(i(308));
			ya = t, e.dependencies = {
				lanes: 0,
				firstContext: t
			}, e.flags |= 524288;
		} else ya = ya.next = t;
		return n;
	}
	var Aa = typeof AbortController < "u" ? AbortController : function() {
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
	}, ja = t.unstable_scheduleCallback, Ma = t.unstable_NormalPriority, Na = {
		$$typeof: se,
		Consumer: null,
		Provider: null,
		_currentValue: null,
		_currentValue2: null,
		_threadCount: 0
	};
	function Pa() {
		return {
			controller: new Aa(),
			data: /* @__PURE__ */ new Map(),
			refCount: 0
		};
	}
	function Fa(e) {
		e.refCount--, e.refCount === 0 && ja(Ma, function() {
			e.controller.abort();
		});
	}
	function Ia(e, t) {
		if (e.pendingLanes & 4194048) {
			var n = e.transitionTypes;
			for (n === null && (n = e.transitionTypes = []), e = 0; e < t.length; e++) {
				var r = t[e];
				n.indexOf(r) === -1 && n.push(r);
			}
		}
	}
	var La = null;
	function Ra(e) {
		var t = e.transitionTypes;
		return e.transitionTypes = null, t;
	}
	var za = null, Ba = 0, Va = 0, Ha = null;
	function Ua(e, t) {
		if (za === null) {
			var n = za = [];
			Ba = 0, Va = Wf(), Ha = {
				status: "pending",
				value: void 0,
				then: function(e) {
					n.push(e);
				}
			};
		}
		return Ba++, t.then(Wa, Wa), t;
	}
	function Wa() {
		if (--Ba === 0 && (La = null, za !== null)) {
			Ha !== null && (Ha.status = "fulfilled");
			var e = za;
			za = null, Va = 0, Ha = null;
			for (var t = 0; t < e.length; t++) (0, e[t])();
		}
	}
	function Ga(e, t) {
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
	var Ka = O.S;
	O.S = function(e, t) {
		if (wd = Je(), typeof t == "object" && t && typeof t.then == "function" && Ua(e, t), La !== null) for (var n = Af; n !== null;) Ia(n, La), n = n.next;
		if (n = e.types, n !== null) {
			for (var r = Af; r !== null;) Ia(r, n), r = r.next;
			if (Va !== 0) {
				r = La, r === null && (r = La = []);
				for (var i = 0; i < n.length; i++) {
					var a = n[i];
					r.indexOf(a) === -1 && r.push(a);
				}
			}
		}
		Ka !== null && Ka(e, t);
	};
	var qa = Ee(null);
	function Ja() {
		var e = qa.current;
		return e === null ? sd.pooledCache : e;
	}
	function Ya(e, t) {
		t === null ? Oe(qa, qa.current) : Oe(qa, t.pool);
	}
	function Xa() {
		var e = Ja();
		return e === null ? null : {
			parent: Na._currentValue,
			pool: e
		};
	}
	var Za = Error(i(460)), Qa = Error(i(474)), $a = Error(i(542)), eo = { then: function() {} };
	function to(e) {
		return e = e.status, e === "fulfilled" || e === "rejected";
	}
	function no(e, t, n) {
		switch (n = e[n], n === void 0 ? e.push(t) : n !== t && (t.then(En, En), t = n), t.status) {
			case "fulfilled": return t.value;
			case "rejected": throw e = t.reason, oo(e), e === void 0 && !("reason" in t) ? Error(i(600)) : e;
			default:
				if (typeof t.status == "string") t.then(En, En);
				else {
					if (e = sd, e !== null && 100 < e.shellSuspendCounter) throw Error(i(482));
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
					case "rejected": throw e = t.reason, oo(e), e;
				}
				throw io = t, Za;
		}
	}
	function ro(e) {
		try {
			var t = e._init;
			return t(e._payload);
		} catch (e) {
			throw typeof e == "object" && e && typeof e.then == "function" ? (io = e, Za) : e;
		}
	}
	var io = null;
	function ao() {
		if (io === null) throw Error(i(459));
		var e = io;
		return io = null, e;
	}
	function oo(e) {
		if (e === Za || e === $a) throw Error(i(483));
	}
	var so = null, co = 0;
	function lo(e) {
		var t = co;
		return co += 1, so === null && (so = []), no(so, e, t);
	}
	function uo(e, t) {
		t = t.props.ref, e.ref = t === void 0 ? null : t;
	}
	function fo(e, t) {
		throw t.$$typeof === te ? Error(i(525)) : (e = Object.prototype.toString.call(t), Error(i(31, e === "[object Object]" ? "object with keys {" + Object.keys(t).join(", ") + "}" : e)));
	}
	function po(e) {
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
			return e = zi(e, t), e.index = 0, e.sibling = null, e;
		}
		function o(t, n, r) {
			return t.index = r, e ? (r = t.alternate, r === null ? (t.flags |= 134217730, n) : (r = r.index, r < n ? (t.flags |= 2, n) : r)) : (t.flags |= 1048576, n);
		}
		function s(t) {
			return e && t.alternate === null && (t.flags |= 134217730), t;
		}
		function c(e, t, n, r) {
			return t === null || t.tag !== 6 ? (t = Ui(n, e.mode, r), t.return = e, t) : (t = a(t, n), t.return = e, t);
		}
		function l(e, t, n, r) {
			var i = n.type;
			return i === re ? (e = d(e, t, n.props.children, r, n.key), uo(e, n), e) : t !== null && (t.elementType === i || typeof i == "object" && i && i.$$typeof === fe && ro(i) === t.type) ? (t = a(t, n.props), uo(t, n), t.return = e, t) : (t = Vi(n.type, n.key, n.props, null, e.mode, r), uo(t, n), t.return = e, t);
		}
		function u(e, t, n, r) {
			return t === null || t.tag !== 4 || t.stateNode.containerInfo !== n.containerInfo || t.stateNode.implementation !== n.implementation ? (t = Gi(n, e.mode, r), t.return = e, t) : (t = a(t, n.children || []), t.return = e, t);
		}
		function d(e, t, n, r, i) {
			return t === null || t.tag !== 7 ? (t = Hi(n, e.mode, r, i), t.return = e, t) : (t = a(t, n), t.return = e, t);
		}
		function f(e, t, n) {
			if (typeof t == "string" && t !== "" || typeof t == "number" || typeof t == "bigint") return t = Ui("" + t, e.mode, n), t.return = e, t;
			if (typeof t == "object" && t) {
				switch (t.$$typeof) {
					case ne: return n = Vi(t.type, t.key, t.props, null, e.mode, n), uo(n, t), n.return = e, n;
					case D: return t = Gi(t, e.mode, n), t.return = e, t;
					case fe: return t = ro(t), f(e, t, n);
				}
				if (Se(t) || ye(t)) return t = Hi(t, e.mode, n, null), t.return = e, t;
				if (typeof t.then == "function") return f(e, lo(t), n);
				if (t.$$typeof === se) return f(e, Oa(e, t), n);
				fo(e, t);
			}
			return null;
		}
		function p(e, t, n, r) {
			var i = t === null ? null : t.key;
			if (typeof n == "string" && n !== "" || typeof n == "number" || typeof n == "bigint") return i === null ? c(e, t, "" + n, r) : null;
			if (typeof n == "object" && n) {
				switch (n.$$typeof) {
					case ne: return n.key === i ? l(e, t, n, r) : null;
					case D: return n.key === i ? u(e, t, n, r) : null;
					case fe: return n = ro(n), p(e, t, n, r);
				}
				if (Se(n) || ye(n)) return i === null ? d(e, t, n, r, null) : null;
				if (typeof n.then == "function") return p(e, t, lo(n), r);
				if (n.$$typeof === se) return p(e, t, Oa(e, n), r);
				fo(e, n);
			}
			return null;
		}
		function m(e, t, n, r, i) {
			if (typeof r == "string" && r !== "" || typeof r == "number" || typeof r == "bigint") return e = e.get(n) || null, c(t, e, "" + r, i);
			if (typeof r == "object" && r) {
				switch (r.$$typeof) {
					case ne: return e = e.get(r.key === null ? n : r.key) || null, l(t, e, r, i);
					case D: return e = e.get(r.key === null ? n : r.key) || null, u(t, e, r, i);
					case fe: return r = ro(r), m(e, t, n, r, i);
				}
				if (Se(r) || ye(r)) return e = e.get(n) || null, d(t, e, r, i, null);
				if (typeof r.then == "function") return m(e, t, n, lo(r), i);
				if (r.$$typeof === se) return m(e, t, n, Oa(t, r), i);
				fo(t, r);
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
			if (h === s.length) return n(i, d), R && I(i, h), l;
			if (d === null) {
				for (; h < s.length; h++) d = f(i, s[h], c), d !== null && (a = o(d, a, h), u === null ? l = d : u.sibling = d, u = d);
				return R && I(i, h), l;
			}
			for (d = r(d); h < s.length; h++) g = m(d, i, h, s[h], c), g !== null && (e && (_ = g.alternate, _ !== null && d.delete(_.key === null ? h : _.key)), a = o(g, a, h), u === null ? l = g : u.sibling = g, u = g);
			return e && d.forEach(function(e) {
				return t(i, e);
			}), R && I(i, h), l;
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
			if (v.done) return n(a, h), R && I(a, g), u;
			if (h === null) {
				for (; !v.done; g++, v = c.next()) v = f(a, v.value, l), v !== null && (s = o(v, s, g), d === null ? u = v : d.sibling = v, d = v);
				return R && I(a, g), u;
			}
			for (h = r(h); !v.done; g++, v = c.next()) v = m(h, a, g, v.value, l), v !== null && (e && (_ = v.alternate, _ !== null && h.delete(_.key === null ? g : _.key)), s = o(v, s, g), d === null ? u = v : d.sibling = v, d = v);
			return e && h.forEach(function(e) {
				return t(a, e);
			}), R && I(a, g), u;
		}
		function _(e, r, o, c) {
			if (typeof o == "object" && o && o.type === re && o.key === null && o.props.ref === void 0 && (o = o.props.children), typeof o == "object" && o) {
				switch (o.$$typeof) {
					case ne:
						a: {
							for (var l = o.key; r !== null;) {
								if (r.key === l) {
									if (l = o.type, l === re) {
										if (r.tag === 7) {
											n(e, r.sibling), c = a(r, o.props.children), uo(c, o), c.return = e, e = c;
											break a;
										}
									} else if (r.elementType === l || typeof l == "object" && l && l.$$typeof === fe && ro(l) === r.type) {
										n(e, r.sibling), c = a(r, o.props), uo(c, o), c.return = e, e = c;
										break a;
									}
									n(e, r);
									break;
								}
								t(e, r), r = r.sibling;
							}
							o.type === re ? (c = Hi(o.props.children, e.mode, c, o.key), uo(c, o), c.return = e, e = c) : (c = Vi(o.type, o.key, o.props, null, e.mode, c), uo(c, o), c.return = e, e = c);
						}
						return s(e);
					case D:
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
							c = Gi(o, e.mode, c), c.return = e, e = c;
						}
						return s(e);
					case fe: return o = ro(o), _(e, r, o, c);
				}
				if (Se(o)) return h(e, r, o, c);
				if (ye(o)) {
					if (l = ye(o), typeof l != "function") throw Error(i(150));
					return o = l.call(o), g(e, r, o, c);
				}
				if (typeof o.then == "function") return _(e, r, lo(o), c);
				if (o.$$typeof === se) return _(e, r, Oa(e, o), c);
				fo(e, o);
			}
			return typeof o == "string" && o !== "" || typeof o == "number" || typeof o == "bigint" ? (o = "" + o, r !== null && r.tag === 6 ? (n(e, r.sibling), c = a(r, o), c.return = e, e = c) : (n(e, r), c = Ui(o, e.mode, c), c.return = e, e = c), s(e)) : n(e, r);
		}
		return function(e, t, n, r) {
			try {
				co = 0;
				var i = _(e, t, n, r);
				return so = null, i;
			} catch (t) {
				if (t === Za || t === $a) throw t;
				var a = Li(29, t, null, e.mode);
				return a.lanes = r, a.return = e, a;
			}
		};
	}
	var mo = po(!0), ho = po(!1), go = !1;
	function _o(e) {
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
	function vo(e, t) {
		e = e.updateQueue, t.updateQueue === e && (t.updateQueue = {
			baseState: e.baseState,
			firstBaseUpdate: e.firstBaseUpdate,
			lastBaseUpdate: e.lastBaseUpdate,
			shared: e.shared,
			callbacks: null
		});
	}
	function yo(e) {
		return {
			lane: e,
			tag: 0,
			payload: null,
			callback: null,
			next: null
		};
	}
	function bo(e, t, n) {
		var r = e.updateQueue;
		if (r === null) return null;
		if (r = r.shared, od & 2) {
			var i = r.pending;
			return i === null ? t.next = t : (t.next = i.next, i.next = t), r.pending = t, t = Pi(e), Ni(e, null, n), t;
		}
		return Ai(e, r, t, n), Pi(e);
	}
	function xo(e, t, n) {
		if (t = t.updateQueue, t !== null && (t = t.shared, n & 4194048)) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, Ct(e, n);
		}
	}
	function So(e, t) {
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
	var Co = !1;
	function wo() {
		if (Co) {
			var e = Ha;
			if (e !== null) throw e;
		}
	}
	function To(e, t, n, r) {
		Co = !1;
		var i = e.updateQueue;
		go = !1;
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
				if (p ? (V & f) === f : (r & f) === f) {
					f !== 0 && f === Va && (Co = !0), u !== null && (u = u.next = {
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
							case 2: go = !0;
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
			u === null && (c = d), i.baseState = c, i.firstBaseUpdate = l, i.lastBaseUpdate = u, a === null && (i.shared.lanes = 0), hd |= o, e.lanes = o, e.memoizedState = d;
		}
	}
	function Eo(e, t) {
		if (typeof e != "function") throw Error(i(191, e));
		e.call(t);
	}
	function Do(e, t) {
		var n = e.callbacks;
		if (n !== null) for (e.callbacks = null, e = 0; e < n.length; e++) Eo(n[e], t);
	}
	var Oo = Ee(null), ko = Ee(0);
	function Ao(e, t) {
		e = pd, Oe(ko, e), Oe(Oo, t), pd = e | t.baseLanes;
	}
	function jo() {
		Oe(ko, pd), Oe(Oo, Oo.current);
	}
	function Mo() {
		pd = ko.current, De(Oo), De(ko);
	}
	var No = Ee(null), Po = null;
	function Fo(e) {
		var t = e.alternate;
		Oe(Bo, Bo.current & 1), Oe(No, e), Po === null && (t === null || Oo.current !== null || t.memoizedState !== null) && (Po = e);
	}
	function Io(e) {
		Oe(Bo, Bo.current), Oe(No, e), Po === null && (Po = e);
	}
	function Lo(e) {
		e.tag === 22 ? (Oe(Bo, Bo.current), Oe(No, e), Po === null && (Po = e)) : Ro();
	}
	function Ro() {
		Oe(Bo, Bo.current), Oe(No, No.current);
	}
	function zo(e) {
		De(No), Po === e && (Po = null), De(Bo);
	}
	var Bo = Ee(0);
	function Vo(e, t) {
		Oe(No, No.current), Oe(Bo, t);
	}
	function Ho(e) {
		De(Bo), De(No), Po === e && (Po = null);
	}
	function Uo(e) {
		for (var t = e; t !== null;) {
			if (t.tag === 13) {
				var n = t.memoizedState;
				if (n !== null && (n = n.dehydrated, n === null || _m(n) || vm(n))) return t;
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
	var Wo = 0, z = null, Go = null, Ko = null, qo = !1, Jo = !1, Yo = !1, Xo = 0, Zo = 0, Qo = null, $o = 0;
	function es() {
		throw Error(i(321));
	}
	function ts(e, t) {
		if (t === null) return !1;
		for (var n = 0; n < t.length && n < e.length; n++) if (!Kr(e[n], t[n])) return !1;
		return !0;
	}
	function ns(e, t, n, r, i, a) {
		return Wo = a, z = t, t.memoizedState = null, t.updateQueue = null, t.lanes = 0, O.H = e === null || e.memoizedState === null ? yc : bc, Yo = !1, a = n(r, i), Yo = !1, Jo && (a = is(t, n, r, i)), rs(e), a;
	}
	function rs(e) {
		O.H = vc;
		var t = Go !== null && Go.next !== null;
		if (Wo = 0, Ko = Go = z = null, qo = !1, Zo = 0, Qo = null, t) throw Error(i(300));
		e === null || Lc || (e = e.dependencies, e !== null && Ta(e) && (Lc = !0));
	}
	function is(e, t, n, r) {
		z = e;
		var a = 0;
		do {
			if (Jo && (Qo = null), Zo = 0, Jo = !1, 25 <= a) throw Error(i(301));
			if (a += 1, Ko = Go = null, e.updateQueue != null) {
				var o = e.updateQueue;
				o.lastEffect = null, o.events = null, o.stores = null, o.memoCache != null && (o.memoCache.index = 0);
			}
			O.H = xc, o = t(n, r);
		} while (Jo);
		return o;
	}
	function as() {
		var e = O.H, t = e.useState()[0];
		return t = typeof t.then == "function" ? fs(t) : t, e = e.useState()[0], (Go === null ? null : Go.memoizedState) !== e && (z.flags |= 1024), t;
	}
	function os() {
		var e = Xo !== 0;
		return Xo = 0, e;
	}
	function ss(e, t, n) {
		t.updateQueue = e.updateQueue, t.flags &= -2053, e.lanes &= ~n;
	}
	function cs(e) {
		if (qo) {
			for (e = e.memoizedState; e !== null;) {
				var t = e.queue;
				t !== null && (t.pending = null), e = e.next;
			}
			qo = !1;
		}
		Wo = 0, Ko = Go = z = null, Jo = !1, Zo = Xo = 0, Qo = null;
	}
	function ls() {
		var e = {
			memoizedState: null,
			baseState: null,
			baseQueue: null,
			queue: null,
			next: null
		};
		return Ko === null ? z.memoizedState = Ko = e : Ko = Ko.next = e, Ko;
	}
	function us() {
		if (Go === null) {
			var e = z.alternate;
			e = e === null ? null : e.memoizedState;
		} else e = Go.next;
		var t = Ko === null ? z.memoizedState : Ko.next;
		if (t !== null) Ko = t, Go = e;
		else {
			if (e === null) throw z.alternate === null ? Error(i(467)) : Error(i(310));
			Go = e, e = {
				memoizedState: Go.memoizedState,
				baseState: Go.baseState,
				baseQueue: Go.baseQueue,
				queue: Go.queue,
				next: null
			}, Ko === null ? z.memoizedState = Ko = e : Ko = Ko.next = e;
		}
		return Ko;
	}
	function ds() {
		return {
			lastEffect: null,
			events: null,
			stores: null,
			memoCache: null
		};
	}
	function fs(e) {
		var t = Zo;
		return Zo += 1, Qo === null && (Qo = []), e = no(Qo, e, t), t = z, (Ko === null ? t.memoizedState : Ko.next) === null && (t = t.alternate, O.H = t === null || t.memoizedState === null ? yc : bc), e;
	}
	function ps(e) {
		if (typeof e == "object" && e) {
			if (typeof e.then == "function") return fs(e);
			if (e.$$typeof === _e) return;
			if (e.$$typeof === se) return Da(e);
		}
		throw Error(i(438, String(e)));
	}
	function ms(e) {
		var t = null, n = z.updateQueue;
		if (n !== null && (t = n.memoCache), t == null) {
			var r = z.alternate;
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
		}, n === null && (n = ds(), z.updateQueue = n), n.memoCache = t, n = t.data[t.index], n === void 0) for (n = t.data[t.index] = Array(e), r = 0; r < e; r++) n[r] = he;
		return t.index++, n;
	}
	function hs(e, t) {
		return typeof t == "function" ? t(e) : t;
	}
	function gs(e) {
		return _s(us(), Go, e);
	}
	function _s(e, t, n) {
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
				if (f === u.lane ? (Wo & f) === f : (V & f) === f) {
					var p = u.revertLane;
					if (p === 0) l !== null && (l = l.next = {
						lane: 0,
						revertLane: 0,
						gesture: null,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}), f === Va && (d = !0);
					else if ((Wo & p) === p) {
						u = u.next, p === Va && (d = !0);
						continue;
					} else f = {
						lane: 0,
						revertLane: u.revertLane,
						gesture: null,
						action: u.action,
						hasEagerState: u.hasEagerState,
						eagerState: u.eagerState,
						next: null
					}, l === null ? (c = l = f, s = o) : l = l.next = f, z.lanes |= p, hd |= p;
					f = u.action, Yo && n(o, f), o = u.hasEagerState ? u.eagerState : n(o, f);
				} else p = {
					lane: f,
					revertLane: u.revertLane,
					gesture: u.gesture,
					action: u.action,
					hasEagerState: u.hasEagerState,
					eagerState: u.eagerState,
					next: null
				}, l === null ? (c = l = p, s = o) : l = l.next = p, z.lanes |= f, hd |= f;
				u = u.next;
			} while (u !== null && u !== t);
			if (l === null ? s = o : l.next = c, !Kr(o, e.memoizedState) && (Lc = !0, d && (n = Ha, n !== null))) throw n;
			e.memoizedState = o, e.baseState = s, e.baseQueue = l, r.lastRenderedState = o;
		}
		return a === null && (r.lanes = 0), [e.memoizedState, r.dispatch];
	}
	function vs(e) {
		var t = us(), n = t.queue;
		if (n === null) throw Error(i(311));
		n.lastRenderedReducer = e;
		var r = n.dispatch, a = n.pending, o = t.memoizedState;
		if (a !== null) {
			n.pending = null;
			var s = a = a.next;
			do
				o = e(o, s.action), s = s.next;
			while (s !== a);
			Kr(o, t.memoizedState) || (Lc = !0), t.memoizedState = o, t.baseQueue === null && (t.baseState = o), n.lastRenderedState = o;
		}
		return [o, r];
	}
	function ys(e, t, n) {
		var r = z, a = us(), o = R;
		if (o) {
			if (n === void 0) throw Error(i(407));
			n = n();
		} else n = t();
		var s = !Kr((Go || a).memoizedState, n);
		if (s && (a.memoizedState = n, Lc = !0), a = a.queue, Ws(Ss.bind(null, r, a, e), [e]), e = a.getSnapshot !== t || s || Ko !== null && !!(Ko.memoizedState.tag & 1), zs(e ? 9 : 8, { destroy: void 0 }, xs.bind(null, r, a, n, t), null), e) {
			if (r.flags |= 2048, sd === null) throw Error(i(349));
			o || Wo & 127 || bs(r, t, n);
		}
		return n;
	}
	function bs(e, t, n) {
		e.flags |= 16384, e = {
			getSnapshot: t,
			value: n
		}, t = z.updateQueue, t === null ? (t = ds(), z.updateQueue = t, t.stores = [e]) : (n = t.stores, n === null ? t.stores = [e] : n.push(e));
	}
	function xs(e, t, n, r) {
		t.value = n, t.getSnapshot = r, Cs(t) && ws(e);
	}
	function Ss(e, t, n) {
		return n(function() {
			Cs(t) && ws(e);
		});
	}
	function Cs(e) {
		var t = e.getSnapshot;
		e = e.value;
		try {
			var n = t();
			return !Kr(e, n);
		} catch {
			return !0;
		}
	}
	function ws(e) {
		var t = Mi(e, 2);
		t !== null && Ud(t, e, 2);
	}
	function Ts(e) {
		var t = ls();
		if (typeof e == "function") {
			var n = e;
			if (e = n(), Yo) {
				at(!0);
				try {
					n();
				} finally {
					at(!1);
				}
			}
		}
		return t.memoizedState = t.baseState = e, t.queue = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: hs,
			lastRenderedState: e
		}, t;
	}
	function Es(e, t, n, r) {
		return e.baseState = n, _s(e, Go, typeof r == "function" ? r : hs);
	}
	function Ds(e, t, n, r, a) {
		if (hc(e)) throw Error(i(485));
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
			O.T === null ? o.isTransition = !1 : n(!0), r(o), n = t.pending, n === null ? (o.next = t.pending = o, Os(t, o)) : (o.next = n.next, t.pending = n.next = o);
		}
	}
	function Os(e, t) {
		var n = t.action, r = t.payload, i = e.state;
		if (t.isTransition) {
			var a = O.T, o = {};
			o.types = a === null ? null : a.types, O.T = o;
			try {
				var s = n(i, r), c = O.S;
				c !== null && c(o, s), ks(e, t, s);
			} catch (n) {
				js(e, t, n);
			} finally {
				a !== null && o.types !== null && (a.types = o.types), O.T = a;
			}
		} else try {
			a = n(i, r), ks(e, t, a);
		} catch (n) {
			js(e, t, n);
		}
	}
	function ks(e, t, n) {
		typeof n == "object" && n && typeof n.then == "function" ? n.then(function(n) {
			As(e, t, n);
		}, function(n) {
			return js(e, t, n);
		}) : As(e, t, n);
	}
	function As(e, t, n) {
		t.status = "fulfilled", t.value = n, Ms(t), e.state = n, t = e.pending, t !== null && (n = t.next, n === t ? e.pending = null : (n = n.next, t.next = n, Os(e, n)));
	}
	function js(e, t, n) {
		var r = e.pending;
		if (e.pending = null, r !== null) {
			r = r.next;
			do
				t.status = "rejected", t.reason = n, Ms(t), t = t.next;
			while (t !== r);
		}
		e.action = null;
	}
	function Ms(e) {
		e = e.listeners;
		for (var t = 0; t < e.length; t++) (0, e[t])();
	}
	function Ns(e, t) {
		return t;
	}
	function Ps(e, t) {
		if (R) {
			var n = sd.formState;
			if (n !== null) {
				a: {
					var r = z;
					if (R) {
						if (oa) {
							b: {
								for (var i = oa, a = ca; i.nodeType !== 8;) {
									if (!a) {
										i = null;
										break b;
									}
									if (i = bm(i.nextSibling), i === null) {
										i = null;
										break b;
									}
								}
								a = i.data, i = a === "F!" || a === "F" ? i : null;
							}
							if (i) {
								oa = bm(i.nextSibling), r = i.data === "F!";
								break a;
							}
						}
						ua(r);
					}
					r = !1;
				}
				r && (t = n[0]);
			}
		}
		return n = ls(), n.memoizedState = n.baseState = t, r = {
			pending: null,
			lanes: 0,
			dispatch: null,
			lastRenderedReducer: Ns,
			lastRenderedState: t
		}, n.queue = r, n = fc.bind(null, z, r), r.dispatch = n, r = Ts(!1), a = mc.bind(null, z, !1, r.queue), r = ls(), i = {
			state: t,
			dispatch: null,
			action: e,
			pending: null
		}, r.queue = i, n = Ds.bind(null, z, i, a, n), i.dispatch = n, r.memoizedState = e, [
			t,
			n,
			!1
		];
	}
	function Fs(e) {
		return Is(us(), Go, e);
	}
	function Is(e, t, n) {
		if (t = _s(e, t, Ns)[0], e = gs(hs)[0], typeof t == "object" && t && typeof t.then == "function") try {
			var r = fs(t);
		} catch (e) {
			throw e === Za ? $a : e;
		}
		else r = t;
		t = us();
		var i = t.queue, a = i.dispatch;
		return n !== t.memoizedState && (z.flags |= 2048, zs(9, { destroy: void 0 }, Ls.bind(null, i, n), null)), [
			r,
			a,
			e
		];
	}
	function Ls(e, t) {
		e.action = t;
	}
	function Rs(e) {
		var t = us(), n = Go;
		if (n !== null) return Is(t, n, e);
		us(), t = t.memoizedState, n = us();
		var r = n.queue.dispatch;
		return n.memoizedState = e, [
			t,
			r,
			!1
		];
	}
	function zs(e, t, n, r) {
		return e = {
			tag: e,
			create: n,
			deps: r,
			inst: t,
			next: null
		}, t = z.updateQueue, t === null && (t = ds(), z.updateQueue = t), n = t.lastEffect, n === null ? t.lastEffect = e.next = e : (r = n.next, n.next = e, e.next = r, t.lastEffect = e), e;
	}
	function Bs() {
		return us().memoizedState;
	}
	function Vs(e, t, n, r) {
		var i = ls();
		z.flags |= e, i.memoizedState = zs(1 | t, { destroy: void 0 }, n, r === void 0 ? null : r);
	}
	function Hs(e, t, n, r) {
		var i = us();
		r = r === void 0 ? null : r;
		var a = i.memoizedState.inst;
		Go !== null && r !== null && ts(r, Go.memoizedState.deps) ? i.memoizedState = zs(t, a, n, r) : (z.flags |= e, i.memoizedState = zs(1 | t, a, n, r));
	}
	function Us(e, t) {
		Vs(8390656, 8, e, t);
	}
	function Ws(e, t) {
		Hs(2048, 8, e, t);
	}
	function Gs(e) {
		z.flags |= 4;
		var t = z.updateQueue;
		if (t === null) t = ds(), z.updateQueue = t, t.events = [e];
		else {
			var n = t.events;
			n === null ? t.events = [e] : n.push(e);
		}
	}
	function Ks(e) {
		var t = us().memoizedState;
		return Gs({
			ref: t,
			nextImpl: e
		}), function() {
			if (od & 2) throw Error(i(440));
			return t.impl.apply(void 0, arguments);
		};
	}
	function qs(e, t) {
		return Hs(4, 2, e, t);
	}
	function Js(e, t) {
		return Hs(4, 4, e, t);
	}
	function Ys(e, t) {
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
	function Xs(e, t, n) {
		n = n == null ? null : n.concat([e]), Hs(4, 4, Ys.bind(null, t, e), n);
	}
	function Zs() {}
	function Qs(e, t) {
		var n = us();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		return t !== null && ts(t, r[1]) ? r[0] : (n.memoizedState = [e, t], e);
	}
	function $s(e, t) {
		var n = us();
		t = t === void 0 ? null : t;
		var r = n.memoizedState;
		if (t !== null && ts(t, r[1])) return r[0];
		if (r = e(), Yo) {
			at(!0);
			try {
				e();
			} finally {
				at(!1);
			}
		}
		return n.memoizedState = [r, t], r;
	}
	function ec(e, t, n) {
		return n === void 0 || Wo & 1073741824 && !(V & 261930) ? e.memoizedState = t : (e.memoizedState = n, e = Vd(), z.lanes |= e, hd |= e, n);
	}
	function tc(e, t, n, r) {
		return Kr(n, t) ? n : Oo.current === null ? !(Wo & 106) || Wo & 1073741824 && !(V & 261930) ? (Lc = !0, e.memoizedState = n) : (e = Vd(), z.lanes |= e, hd |= e, t) : (e = ec(e, n, r), Kr(e, t) || (Lc = !0), e);
	}
	function nc(e, t, n, r, i) {
		var a = k.p;
		k.p = a !== 0 && 8 > a ? a : 8;
		var o = O.T, s = {};
		s.types = o === null ? null : o.types, O.T = s, mc(e, !1, t, n);
		try {
			var c = i(), l = O.S;
			l !== null && l(s, c), typeof c == "object" && c && typeof c.then == "function" ? pc(e, t, Ga(c, r), Bd(e)) : pc(e, t, r, Bd(e));
		} catch (n) {
			pc(e, t, {
				then: function() {},
				status: "rejected",
				reason: n
			}, Bd());
		} finally {
			k.p = a, o !== null && s.types !== null && (o.types = s.types), O.T = o;
		}
	}
	function rc() {}
	function ic(e, t, n, r) {
		if (e.tag !== 5) throw Error(i(476));
		var a = ac(e).queue;
		nc(e, a, t, Ce, n === null ? rc : function() {
			return oc(e), n(r);
		});
	}
	function ac(e) {
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
				lastRenderedReducer: hs,
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
				lastRenderedReducer: hs,
				lastRenderedState: n
			},
			next: null
		}, e.memoizedState = t, e = e.alternate, e !== null && (e.memoizedState = t), t;
	}
	function oc(e) {
		var t = ac(e);
		t.next === null && (t = e.alternate.memoizedState), pc(e, t.next.queue, {}, Bd());
	}
	function sc() {
		return Da(gh);
	}
	function cc() {
		return us().memoizedState;
	}
	function lc() {
		return us().memoizedState;
	}
	function uc(e) {
		for (var t = e.return; t !== null;) {
			switch (t.tag) {
				case 24:
				case 3:
					var n = Bd();
					e = yo(n);
					var r = bo(t, e, n);
					r !== null && (Ud(r, t, n), xo(r, t, n)), t = { cache: Pa() }, e.payload = t;
					return;
			}
			t = t.return;
		}
	}
	function dc(e, t, n) {
		var r = Bd();
		n = {
			lane: r,
			revertLane: 0,
			gesture: null,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, hc(e) ? gc(t, n) : (n = ji(e, t, n, r), n !== null && (Ud(n, e, r), _c(n, t, r)));
	}
	function fc(e, t, n) {
		pc(e, t, n, Bd());
	}
	function pc(e, t, n, r) {
		var i = {
			lane: r,
			revertLane: 0,
			gesture: null,
			action: n,
			hasEagerState: !1,
			eagerState: null,
			next: null
		};
		if (hc(e)) gc(t, i);
		else {
			var a = e.alternate;
			if (e.lanes === 0 && (a === null || a.lanes === 0) && (a = t.lastRenderedReducer, a !== null)) try {
				var o = t.lastRenderedState, s = a(o, n);
				if (i.hasEagerState = !0, i.eagerState = s, Kr(s, o)) return Ai(e, t, i, 0), sd === null && ki(), !1;
			} catch {}
			if (n = ji(e, t, i, r), n !== null) return Ud(n, e, r), _c(n, t, r), !0;
		}
		return !1;
	}
	function mc(e, t, n, r) {
		if (r = {
			lane: 2,
			revertLane: Wf(),
			gesture: null,
			action: r,
			hasEagerState: !1,
			eagerState: null,
			next: null
		}, hc(e)) {
			if (t) throw Error(i(479));
		} else t = ji(e, n, r, 2), t !== null && Ud(t, e, 2);
	}
	function hc(e) {
		var t = e.alternate;
		return e === z || t !== null && t === z;
	}
	function gc(e, t) {
		Jo = qo = !0;
		var n = e.pending;
		n === null ? t.next = t : (t.next = n.next, n.next = t), e.pending = t;
	}
	function _c(e, t, n) {
		if (n & 4194048) {
			var r = t.lanes;
			r &= e.pendingLanes, n |= r, t.lanes = n, Ct(e, n);
		}
	}
	var vc = {
		readContext: Da,
		use: ps,
		useCallback: es,
		useContext: es,
		useEffect: es,
		useImperativeHandle: es,
		useLayoutEffect: es,
		useInsertionEffect: es,
		useMemo: es,
		useReducer: es,
		useRef: es,
		useState: es,
		useDebugValue: es,
		useDeferredValue: es,
		useTransition: es,
		useSyncExternalStore: es,
		useId: es,
		useHostTransitionStatus: es,
		useFormState: es,
		useActionState: es,
		useOptimistic: es,
		useMemoCache: es,
		useCacheRefresh: es,
		useEffectEvent: es
	}, yc = {
		readContext: Da,
		use: ps,
		useCallback: function(e, t) {
			return ls().memoizedState = [e, t === void 0 ? null : t], e;
		},
		useContext: Da,
		useEffect: Us,
		useImperativeHandle: function(e, t, n) {
			n = n == null ? null : n.concat([e]), Vs(4194308, 4, Ys.bind(null, t, e), n);
		},
		useLayoutEffect: function(e, t) {
			return Vs(4194308, 4, e, t);
		},
		useInsertionEffect: function(e, t) {
			Vs(4, 2, e, t);
		},
		useMemo: function(e, t) {
			var n = ls();
			t = t === void 0 ? null : t;
			var r = e();
			if (Yo) {
				at(!0);
				try {
					e();
				} finally {
					at(!1);
				}
			}
			return n.memoizedState = [r, t], r;
		},
		useReducer: function(e, t, n) {
			var r = ls();
			if (n !== void 0) {
				var i = n(t);
				if (Yo) {
					at(!0);
					try {
						n(t);
					} finally {
						at(!1);
					}
				}
			} else i = t;
			return r.memoizedState = r.baseState = i, e = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: e,
				lastRenderedState: i
			}, r.queue = e, e = e.dispatch = dc.bind(null, z, e), [r.memoizedState, e];
		},
		useRef: function(e) {
			var t = ls();
			return e = { current: e }, t.memoizedState = e;
		},
		useState: function(e) {
			e = Ts(e);
			var t = e.queue, n = fc.bind(null, z, t);
			return t.dispatch = n, [e.memoizedState, n];
		},
		useDebugValue: Zs,
		useDeferredValue: function(e, t) {
			return ec(ls(), e, t);
		},
		useTransition: function() {
			var e = Ts(!1);
			return e = nc.bind(null, z, e.queue, !0, !1), ls().memoizedState = e, [!1, e];
		},
		useSyncExternalStore: function(e, t, n) {
			var r = z, a = ls();
			if (R) {
				if (n === void 0) throw Error(i(407));
				n = n();
			} else {
				if (n = t(), sd === null) throw Error(i(349));
				V & 127 || bs(r, t, n);
			}
			a.memoizedState = n;
			var o = {
				value: n,
				getSnapshot: t
			};
			return a.queue = o, Us(Ss.bind(null, r, o, e), [e]), r.flags |= 2048, zs(9, { destroy: void 0 }, xs.bind(null, r, o, n, t), null), n;
		},
		useId: function() {
			var e = ls(), t = sd.identifierPrefix;
			if (R) {
				var n = ta, r = ea;
				n = (r & ~(1 << 32 - ot(r) - 1)).toString(32) + n, t = "_" + t + "R_" + n, n = Xo++, 0 < n && (t += "H" + n.toString(32)), t += "_";
			} else n = $o++, t = "_" + t + "r_" + n.toString(32) + "_";
			return e.memoizedState = t;
		},
		useHostTransitionStatus: sc,
		useFormState: Ps,
		useActionState: Ps,
		useOptimistic: function(e) {
			var t = ls();
			t.memoizedState = t.baseState = e;
			var n = {
				pending: null,
				lanes: 0,
				dispatch: null,
				lastRenderedReducer: null,
				lastRenderedState: null
			};
			return t.queue = n, t = mc.bind(null, z, !0, n), n.dispatch = t, [e, t];
		},
		useMemoCache: ms,
		useCacheRefresh: function() {
			return ls().memoizedState = uc.bind(null, z);
		},
		useEffectEvent: function(e) {
			var t = ls(), n = { impl: e };
			return t.memoizedState = n, function() {
				if (od & 2) throw Error(i(440));
				return n.impl.apply(void 0, arguments);
			};
		}
	}, bc = {
		readContext: Da,
		use: ps,
		useCallback: Qs,
		useContext: Da,
		useEffect: Ws,
		useImperativeHandle: Xs,
		useInsertionEffect: qs,
		useLayoutEffect: Js,
		useMemo: $s,
		useReducer: gs,
		useRef: Bs,
		useState: function() {
			return gs(hs);
		},
		useDebugValue: Zs,
		useDeferredValue: function(e, t) {
			return tc(us(), Go.memoizedState, e, t);
		},
		useTransition: function() {
			var e = gs(hs)[0], t = us().memoizedState;
			return [typeof e == "boolean" ? e : fs(e), t];
		},
		useSyncExternalStore: ys,
		useId: cc,
		useHostTransitionStatus: sc,
		useFormState: Fs,
		useActionState: Fs,
		useOptimistic: function(e, t) {
			return Es(us(), Go, e, t);
		},
		useMemoCache: ms,
		useCacheRefresh: lc,
		useEffectEvent: Ks
	}, xc = {
		readContext: Da,
		use: ps,
		useCallback: Qs,
		useContext: Da,
		useEffect: Ws,
		useImperativeHandle: Xs,
		useInsertionEffect: qs,
		useLayoutEffect: Js,
		useMemo: $s,
		useReducer: vs,
		useRef: Bs,
		useState: function() {
			return vs(hs);
		},
		useDebugValue: Zs,
		useDeferredValue: function(e, t) {
			var n = us();
			return Go === null ? ec(n, e, t) : tc(n, Go.memoizedState, e, t);
		},
		useTransition: function() {
			var e = vs(hs)[0], t = us().memoizedState;
			return [typeof e == "boolean" ? e : fs(e), t];
		},
		useSyncExternalStore: ys,
		useId: cc,
		useHostTransitionStatus: sc,
		useFormState: Rs,
		useActionState: Rs,
		useOptimistic: function(e, t) {
			var n = us();
			return Go === null ? (n.baseState = e, [e, n.queue.dispatch]) : Es(n, Go, e, t);
		},
		useMemoCache: ms,
		useCacheRefresh: lc,
		useEffectEvent: Ks
	};
	function Sc(e, t, n, r) {
		t = e.memoizedState, n = n(r, t), n = n == null ? t : E({}, t, n), e.memoizedState = n, e.lanes === 0 && (e.updateQueue.baseState = n);
	}
	var Cc = {
		enqueueSetState: function(e, t, n) {
			e = e._reactInternals;
			var r = Bd(), i = yo(r);
			i.payload = t, n != null && (i.callback = n), t = bo(e, i, r), t !== null && (Ud(t, e, r), xo(t, e, r));
		},
		enqueueReplaceState: function(e, t, n) {
			e = e._reactInternals;
			var r = Bd(), i = yo(r);
			i.tag = 1, i.payload = t, n != null && (i.callback = n), t = bo(e, i, r), t !== null && (Ud(t, e, r), xo(t, e, r));
		},
		enqueueForceUpdate: function(e, t) {
			e = e._reactInternals;
			var n = Bd(), r = yo(n);
			r.tag = 2, t != null && (r.callback = t), t = bo(e, r, n), t !== null && (Ud(t, e, n), xo(t, e, n));
		}
	};
	function wc(e, t, n, r, i, a, o) {
		return e = e.stateNode, typeof e.shouldComponentUpdate == "function" ? e.shouldComponentUpdate(r, a, o) : t.prototype && t.prototype.isPureReactComponent ? !qr(n, r) || !qr(i, a) : !0;
	}
	function Tc(e, t, n, r) {
		e = t.state, typeof t.componentWillReceiveProps == "function" && t.componentWillReceiveProps(n, r), typeof t.UNSAFE_componentWillReceiveProps == "function" && t.UNSAFE_componentWillReceiveProps(n, r), t.state !== e && Cc.enqueueReplaceState(t, t.state, null);
	}
	function Ec(e, t) {
		var n = t;
		if ("ref" in t) for (var r in n = {}, t) r !== "ref" && (n[r] = t[r]);
		if (e = e.defaultProps) for (var i in n === t && (n = E({}, n)), e) n[i] === void 0 && (n[i] = e[i]);
		return n;
	}
	function Dc(e) {
		Ti(e);
	}
	function Oc(e) {
		console.error(e);
	}
	function kc(e) {
		Ti(e);
	}
	function Ac(e, t) {
		try {
			var n = e.onUncaughtError;
			n(t.value, { componentStack: t.stack });
		} catch (e) {
			setTimeout(function() {
				throw e;
			});
		}
	}
	function jc(e, t, n) {
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
	function Mc(e, t, n) {
		return n = yo(n), n.tag = 3, n.payload = { element: null }, n.callback = function() {
			Ac(e, t);
		}, n;
	}
	function Nc(e) {
		return e = yo(e), e.tag = 3, e;
	}
	function Pc(e, t, n, r) {
		var i = n.type.getDerivedStateFromError;
		if (typeof i == "function") {
			var a = r.value;
			e.payload = function() {
				return i(a);
			}, e.callback = function() {
				jc(t, n, r);
			};
		}
		var o = n.stateNode;
		o !== null && typeof o.componentDidCatch == "function" && (e.callback = function() {
			jc(t, n, r), typeof i != "function" && (Dd === null ? Dd = /* @__PURE__ */ new Set([this]) : Dd.add(this));
			var e = r.stack;
			this.componentDidCatch(r.value, { componentStack: e === null ? "" : e });
		});
	}
	function Fc(e, t, n, r, a) {
		if (n.flags |= 32768, typeof r == "object" && r && typeof r.then == "function") {
			if (t = n.alternate, t !== null && wa(t, n, a, !0), n = No.current, n !== null) {
				switch (n.tag) {
					case 31:
					case 13:
					case 19: return Po === null ? tf() : n.alternate === null && md === 0 && (md = 3), n.flags &= -257, n.flags |= 65536, n.lanes = a, r === eo ? n.flags |= 16384 : (t = n.updateQueue, t === null ? n.updateQueue = /* @__PURE__ */ new Set([r]) : t.add(r), wf(e, r, a)), !1;
					case 22: return n.flags |= 65536, r === eo ? n.flags |= 16384 : (t = n.updateQueue, t === null ? (t = {
						transitions: null,
						markerInstances: null,
						retryQueue: /* @__PURE__ */ new Set([r])
					}, n.updateQueue = t) : (n = t.retryQueue, n === null ? t.retryQueue = /* @__PURE__ */ new Set([r]) : n.add(r)), wf(e, r, a)), !1;
				}
				throw Error(i(435, n.tag));
			}
			return wf(e, r, a), tf(), !1;
		}
		if (R) return t = No.current, t === null ? (r !== la && (t = Error(i(423), { cause: r }), ga(F(t, n))), e = e.current.alternate, e.flags |= 65536, a &= -a, e.lanes |= a, r = F(r, n), a = Mc(e.stateNode, r, a), So(e, a), md !== 4 && (md = 2)) : (!(t.flags & 65536) && (t.flags |= 256), t.flags |= 65536, t.lanes = a, r !== la && (e = Error(i(422), { cause: r }), ga(F(e, n)))), !1;
		var o = Error(i(520), { cause: r });
		if (o = F(o, n), bd === null ? bd = [o] : bd.push(o), md !== 4 && (md = 2), t === null) return !0;
		r = F(r, n), n = t;
		do {
			switch (n.tag) {
				case 3: return n.flags |= 65536, e = a & -a, n.lanes |= e, e = Mc(n.stateNode, r, e), So(n, e), !1;
				case 1:
					if (t = n.type, o = n.stateNode, !(n.flags & 128) && (typeof t.getDerivedStateFromError == "function" || o !== null && typeof o.componentDidCatch == "function" && (Dd === null || !Dd.has(o)))) return n.flags |= 65536, a &= -a, n.lanes |= a, a = Nc(a), Pc(a, e, n, r), So(n, a), !1;
					break;
				case 22: if (n.memoizedState !== null) return n.flags |= 65536, !1;
			}
			n = n.return;
		} while (n !== null);
		return !1;
	}
	var Ic = Error(i(461)), Lc = !1;
	function Rc(e, t, n, r) {
		t.child = e === null ? ho(t, null, n, r) : mo(t, e.child, n, r);
	}
	function zc(e, t, n, r, i) {
		n = n.render;
		var a = t.ref;
		if ("ref" in r) {
			var o = {};
			for (var s in r) s !== "ref" && (o[s] = r[s]);
		} else o = r;
		return Ea(t), r = ns(e, t, n, o, a, i), s = os(), e !== null && !Lc ? (ss(e, t, i), pl(e, t, i)) : (R && s && L(t), t.flags |= 1, Rc(e, t, r, i), t.child);
	}
	function Bc(e, t, n, r, i) {
		if (e === null) {
			var a = n.type;
			return typeof a == "function" && !Ri(a) && a.defaultProps === void 0 && n.compare === null ? (t.tag = 15, t.type = a, Vc(e, t, a, r, i)) : (e = Vi(n.type, null, r, t, t.mode, i), e.ref = t.ref, e.return = t, t.child = e);
		}
		if (a = e.child, !ml(e, i)) {
			var o = a.memoizedProps;
			if (n = n.compare, n = n === null ? qr : n, n(o, r) && e.ref === t.ref) return pl(e, t, i);
		}
		return t.flags |= 1, e = zi(a, r), e.ref = t.ref, e.return = t, t.child = e;
	}
	function Vc(e, t, n, r, i) {
		if (e !== null) {
			var a = e.memoizedProps;
			if (qr(a, r) && e.ref === t.ref) {
				if (Lc = !1, t.pendingProps = r = a, ml(e, i)) e.flags & 131072 && (Lc = !0);
				else return t.lanes = e.lanes, pl(e, t, i);
			}
		}
		return Yc(e, t, n, r, i);
	}
	function Hc(e, t, n, r) {
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
				return Wc(e, t, a, n, r);
			}
			if (n & 536870912) t.memoizedState = {
				baseLanes: 0,
				cachePool: null
			}, e !== null && Ya(t, a === null ? null : a.cachePool), a === null ? jo() : Ao(t, a), Lo(t);
			else return r = t.lanes = 536870912, Wc(e, t, a === null ? n : a.baseLanes | n, n, r);
		} else a === null ? (e !== null && Ya(t, null), jo(), Ro()) : (Ya(t, a.cachePool), Ao(t, a), Ro(), t.memoizedState = null);
		return Rc(e, t, i, n), t.child;
	}
	function Uc(e, t) {
		return e !== null && e.tag === 22 || t.stateNode !== null || (t.stateNode = {
			_visibility: 1,
			_pendingMarkers: null,
			_retryCache: null,
			_transitions: null
		}), t.sibling;
	}
	function Wc(e, t, n, r, i) {
		var a = Ja();
		return a = a === null ? null : {
			parent: Na._currentValue,
			pool: a
		}, t.memoizedState = {
			baseLanes: n,
			cachePool: a
		}, e !== null && Ya(t, null), jo(), Lo(t), e !== null && wa(e, t, r, !0), t.childLanes = i, null;
	}
	function Gc(e, t) {
		return t = il({
			mode: t.mode,
			children: t.children
		}, e.mode), t.ref = e.ref, e.child = t, t.return = e, t;
	}
	function Kc(e, t, n) {
		return mo(t, e.child, null, n), e = Gc(t, t.pendingProps), e.flags |= 2, zo(t), t.memoizedState = null, e;
	}
	function qc(e, t, n) {
		var r = t.pendingProps, a = !!(t.flags & 128);
		if (t.flags &= -129, e === null) {
			if (R) {
				if (r.mode === "hidden") return e = Gc(t, r), t.lanes = 536870912, e.memoizedState = {
					baseLanes: 0,
					cachePool: null
				}, Uc(null, e);
				if (Io(t), (e = oa) ? (e = gm(e, ca), e = e !== null && e.data === "&" ? e : null, e !== null && (t.memoizedState = {
					dehydrated: e,
					treeContext: $i === null ? null : {
						id: ea,
						overflow: ta
					},
					retryLane: 536870912,
					hydrationErrors: null
				}, n = Wi(e), n.return = t, t.child = n, aa = t, oa = null)) : e = null, e === null) throw ua(t);
				return t.lanes = 536870912, null;
			}
			return Gc(t, r);
		}
		var o = e.memoizedState;
		if (o !== null) {
			var s = o.dehydrated;
			if (Io(t), a) {
				if (t.flags & 256) t.flags &= -257, t = Kc(e, t, n);
				else if (t.memoizedState !== null) t.child = e.child, t.flags |= 128, t = null;
				else throw Error(i(558));
			} else if (Lc || wa(e, t, n, !1), a = (n & e.childLanes) !== 0, Lc || a) {
				if (Oo.current === null) {
					if (r = sd, r !== null && (s = wt(r, n), s !== 0 && s !== o.retryLane)) throw o.retryLane = s, Mi(e, s), Ud(r, e, s), Ic;
					tf();
				}
				t = Kc(e, t, n);
			} else e = o.treeContext, oa = bm(s.nextSibling), aa = t, R = !0, sa = null, ca = !1, e !== null && ia(t, e), t = Gc(t, r), t.flags |= 134221824;
			return t;
		}
		return e = zi(e.child, {
			mode: r.mode,
			children: r.children
		}), e.ref = t.ref, t.child = e, e.return = t, e;
	}
	function Jc(e, t) {
		var n = t.ref;
		if (n === null) e !== null && e.ref !== null && (t.flags |= 4194816);
		else {
			if (typeof n != "function" && typeof n != "object") throw Error(i(284));
			(e === null || e.ref !== n) && (t.flags |= 4194816);
		}
	}
	function Yc(e, t, n, r, i) {
		return Ea(t), n = ns(e, t, n, r, void 0, i), r = os(), e !== null && !Lc ? (ss(e, t, i), pl(e, t, i)) : (R && r && L(t), t.flags |= 1, Rc(e, t, n, i), t.child);
	}
	function Xc(e, t, n, r, i, a) {
		return Ea(t), t.updateQueue = null, n = is(t, r, n, i), rs(e), r = os(), e !== null && !Lc ? (ss(e, t, a), pl(e, t, a)) : (R && r && L(t), t.flags |= 1, Rc(e, t, n, a), t.child);
	}
	function Zc(e, t, n, r, i) {
		if (Ea(t), t.stateNode === null) {
			var a = Fi, o = n.contextType;
			typeof o == "object" && o && (a = Da(o)), a = new n(r, a), t.memoizedState = a.state !== null && a.state !== void 0 ? a.state : null, a.updater = Cc, t.stateNode = a, a._reactInternals = t, a = t.stateNode, a.props = r, a.state = t.memoizedState, a.refs = {}, _o(t), o = n.contextType, a.context = typeof o == "object" && o ? Da(o) : Fi, a.state = t.memoizedState, o = n.getDerivedStateFromProps, typeof o == "function" && (Sc(t, n, o, r), a.state = t.memoizedState), typeof n.getDerivedStateFromProps == "function" || typeof a.getSnapshotBeforeUpdate == "function" || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (o = a.state, typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount(), o !== a.state && Cc.enqueueReplaceState(a, a.state, null), To(t, r, a, i), wo(), a.state = t.memoizedState), typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !0;
		} else if (e === null) {
			a = t.stateNode;
			var s = t.memoizedProps, c = Ec(n, s);
			a.props = c;
			var l = a.context, u = n.contextType;
			o = Fi, typeof u == "object" && u && (o = Da(u));
			var d = n.getDerivedStateFromProps;
			u = typeof d == "function" || typeof a.getSnapshotBeforeUpdate == "function", s = t.pendingProps !== s, u || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (s || l !== o) && Tc(t, a, r, o), go = !1;
			var f = t.memoizedState;
			a.state = f, To(t, r, a, i), wo(), l = t.memoizedState, s || f !== l || go ? (typeof d == "function" && (Sc(t, n, d, r), l = t.memoizedState), (c = go || wc(t, n, c, r, f, l, o)) ? (u || typeof a.UNSAFE_componentWillMount != "function" && typeof a.componentWillMount != "function" || (typeof a.componentWillMount == "function" && a.componentWillMount(), typeof a.UNSAFE_componentWillMount == "function" && a.UNSAFE_componentWillMount()), typeof a.componentDidMount == "function" && (t.flags |= 4194308)) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), t.memoizedProps = r, t.memoizedState = l), a.props = r, a.state = l, a.context = o, r = c) : (typeof a.componentDidMount == "function" && (t.flags |= 4194308), r = !1);
		} else {
			a = t.stateNode, vo(e, t), o = t.memoizedProps, u = Ec(n, o), a.props = u, d = t.pendingProps, f = a.context, l = n.contextType, c = Fi, typeof l == "object" && l && (c = Da(l)), s = n.getDerivedStateFromProps, (l = typeof s == "function" || typeof a.getSnapshotBeforeUpdate == "function") || typeof a.UNSAFE_componentWillReceiveProps != "function" && typeof a.componentWillReceiveProps != "function" || (o !== d || f !== c) && Tc(t, a, r, c), go = !1, f = t.memoizedState, a.state = f, To(t, r, a, i), wo();
			var p = t.memoizedState;
			o !== d || f !== p || go || e !== null && e.dependencies !== null && Ta(e.dependencies) ? (typeof s == "function" && (Sc(t, n, s, r), p = t.memoizedState), (u = go || wc(t, n, u, r, f, p, c) || e !== null && e.dependencies !== null && Ta(e.dependencies)) ? (l || typeof a.UNSAFE_componentWillUpdate != "function" && typeof a.componentWillUpdate != "function" || (typeof a.componentWillUpdate == "function" && a.componentWillUpdate(r, p, c), typeof a.UNSAFE_componentWillUpdate == "function" && a.UNSAFE_componentWillUpdate(r, p, c)), typeof a.componentDidUpdate == "function" && (t.flags |= 4), typeof a.getSnapshotBeforeUpdate == "function" && (t.flags |= 1024)) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), t.memoizedProps = r, t.memoizedState = p), a.props = r, a.state = p, a.context = c, r = u) : (typeof a.componentDidUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 4), typeof a.getSnapshotBeforeUpdate != "function" || o === e.memoizedProps && f === e.memoizedState || (t.flags |= 1024), r = !1);
		}
		return a = r, Jc(e, t), r = !!(t.flags & 128), a || r ? (a = t.stateNode, n = r && typeof n.getDerivedStateFromError != "function" ? null : a.render(), t.flags |= 1, e !== null && r ? (t.child = mo(t, e.child, null, i), t.child = mo(t, null, n, i)) : Rc(e, t, n, i), t.memoizedState = a.state, e = t.child) : e = pl(e, t, i), e;
	}
	function Qc(e, t, n, r) {
		return ma(), t.flags |= 256, Rc(e, t, n, r), t.child;
	}
	var $c = {
		dehydrated: null,
		treeContext: null,
		retryLane: 0,
		hydrationErrors: null
	};
	function el(e) {
		return {
			baseLanes: e,
			cachePool: Xa()
		};
	}
	function tl(e, t, n) {
		return e = e === null ? 0 : e.childLanes & ~n, t && (e |= vd), e;
	}
	function nl(e, t, n) {
		var r = t.pendingProps, i = !1, a = !!(t.flags & 128), o;
		if ((o = a) || (o = e !== null && e.memoizedState === null ? !1 : !!(Bo.current & 2)), o && (i = !0, t.flags &= -129), o = !!(t.flags & 32), t.flags &= -33, e === null) {
			if (R) {
				if (i ? Fo(t) : Ro(), (e = oa) ? (e = gm(e, ca), e = e !== null && e.data !== "&" ? e : null, e !== null && (t.memoizedState = {
					dehydrated: e,
					treeContext: $i === null ? null : {
						id: ea,
						overflow: ta
					},
					retryLane: 536870912,
					hydrationErrors: null
				}, n = Wi(e), n.return = t, t.child = n, aa = t, oa = null)) : e = null, e === null) throw ua(t);
				return t.lanes = vm(e) ? 32 : 536870912, null;
			}
			return a = r.children, r = r.fallback, i ? (Ro(), i = t.mode, a = il({
				mode: "hidden",
				children: a
			}, i), r = Hi(r, i, n, null), a.return = t, r.return = t, a.sibling = r, t.child = a, r = t.child, r.memoizedState = el(n), r.childLanes = tl(e, o, n), t.memoizedState = $c, Uc(null, r)) : (Fo(t), rl(t, a));
		}
		var s = e.memoizedState;
		if (s !== null) {
			var c = s.dehydrated;
			if (c !== null) return ol(e, t, a, o, r, c, s, n);
		}
		return i ? (Ro(), i = r.fallback, a = t.mode, s = e.child, c = s.sibling, r = zi(s, {
			mode: "hidden",
			children: r.children
		}), r.subtreeFlags = s.subtreeFlags & 1206910976, c === null ? (i = Hi(i, a, n, null), i.flags |= 2) : i = zi(c, i), i.return = t, r.return = t, r.sibling = i, t.child = r, Uc(null, r), r = t.child, i = e.child.memoizedState, i === null ? i = el(n) : (a = i.cachePool, a === null ? a = Xa() : (s = Na._currentValue, a = a.parent === s ? a : {
			parent: s,
			pool: s
		}), i = {
			baseLanes: i.baseLanes | n,
			cachePool: a
		}), r.memoizedState = i, r.childLanes = tl(e, o, n), t.memoizedState = $c, Uc(e.child, r)) : (Fo(t), n = e.child, e = n.sibling, n = zi(n, {
			mode: "visible",
			children: r.children
		}), n.return = t, n.sibling = null, e !== null && (o = t.deletions, o === null ? (t.deletions = [e], t.flags |= 16) : o.push(e)), t.child = n, t.memoizedState = null, n);
	}
	function rl(e, t) {
		return t = il({
			mode: "visible",
			children: t
		}, e.mode), t.return = e, e.child = t;
	}
	function il(e, t) {
		return e = Li(22, e, null, t), e.lanes = 0, e;
	}
	function al(e, t, n) {
		return mo(t, e.child, null, n), e = rl(t, t.pendingProps.children), e.flags |= 2, t.memoizedState = null, e;
	}
	function ol(e, t, n, r, a, o, s, c) {
		if (n) return t.flags & 256 ? (Fo(t), t.flags &= -257, al(e, t, c)) : t.memoizedState === null ? (Ro(), o = a.fallback, s = t.mode, a = il({
			mode: "visible",
			children: a.children
		}, s), o = Hi(o, s, c, null), o.flags |= 2, a.return = t, o.return = t, a.sibling = o, t.child = a, mo(t, e.child, null, c), a = t.child, a.memoizedState = el(c), a.childLanes = tl(e, r, c), t.memoizedState = $c, Uc(null, a)) : (Ro(), t.child = e.child, t.flags |= 128, null);
		if (Fo(t), vm(o)) {
			if (r = o.nextSibling && o.nextSibling.dataset, r) var l = r.dgst;
			return r = l, r !== "" && (a = Error(i(419)), a.stack = "", a.digest = r, ga({
				value: a,
				source: null,
				stack: null
			})), al(e, t, c);
		}
		if (Lc || wa(e, t, c, !1), r = (c & e.childLanes) !== 0, Lc || r) {
			if (Oo.current !== null) return al(e, t, c);
			if (r = sd, r !== null && (a = wt(r, c), a !== 0 && a !== s.retryLane)) throw s.retryLane = a, Mi(e, a), Ud(r, e, a), Ic;
			return _m(o) || tf(), al(e, t, c);
		}
		return _m(o) ? (t.flags |= 192, t.child = e.child, null) : (e = s.treeContext, oa = bm(o.nextSibling), aa = t, R = !0, sa = null, ca = !1, e !== null && ia(t, e), t = rl(t, a.children), t.flags |= 134221824, t);
	}
	function sl(e, t, n) {
		e.lanes |= t;
		var r = e.alternate;
		r !== null && (r.lanes |= t), Sa(e.return, t, n);
	}
	function cl(e) {
		for (var t = null; e !== null;) {
			var n = e.alternate;
			n !== null && Uo(n) === null && (t = e), e = e.sibling;
		}
		return t;
	}
	function ll(e, t, n, r, i, a) {
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
	function ul(e) {
		var t = e.child;
		for (e.child = null; t !== null;) {
			var n = t.sibling;
			t.sibling = e.child, e.child = t, t = n;
		}
	}
	function dl(e, t, n) {
		var r = t.pendingProps, i = r.revealOrder, a = r.tail;
		r = r.children;
		var o = Bo.current;
		if (t.flags & 128) return Vo(t, o), null;
		var s = !!(o & 2);
		if (s ? (o = o & 1 | 2, t.flags |= 128) : o &= 1, Vo(t, o), i === "backwards" && e !== null ? (ul(e), Rc(e, t, r, n), ul(e)) : Rc(e, t, r, n), r = R ? Xi : 0, !s && e !== null && e.flags & 128) a: for (e = t.child; e !== null;) {
			if (e.tag === 13) e.memoizedState !== null && sl(e, n, t);
			else if (e.tag === 19) sl(e, n, t);
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
				n = cl(t.child), n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null, ul(t)), ll(t, !0, i, null, a, r);
				break;
			case "unstable_legacy-backwards":
				for (n = null, i = t.child, t.child = null; i !== null;) {
					if (e = i.alternate, e !== null && Uo(e) === null) {
						t.child = i;
						break;
					}
					e = i.sibling, i.sibling = n, n = i, i = e;
				}
				ll(t, !0, n, null, a, r);
				break;
			case "together":
				ll(t, !1, null, null, void 0, r);
				break;
			case "independent":
				t.memoizedState = null;
				break;
			default: n = cl(t.child), n === null ? (i = t.child, t.child = null) : (i = n.sibling, n.sibling = null), ll(t, !1, i, n, a, r);
		}
		return t.child;
	}
	function fl(e, t, n) {
		var r = t.pendingProps;
		return ba(t, t.type, r.value), Rc(e, t, r.children, n), t.child;
	}
	function pl(e, t, n) {
		if (e !== null && (t.dependencies = e.dependencies), hd |= t.lanes, (n & t.childLanes) === 0) {
			if (e !== null) {
				if (wa(e, t, n, !1), (n & t.childLanes) === 0) return null;
			} else return null;
		}
		if (e !== null && t.child !== e.child) throw Error(i(153));
		if (t.child !== null) {
			for (e = t.child, n = zi(e, e.pendingProps), t.child = n, n.return = t; e.sibling !== null;) e = e.sibling, n = n.sibling = zi(e, e.pendingProps), n.return = t;
			n.sibling = null;
		}
		return t.child;
	}
	function ml(e, t) {
		return (e.lanes & t) !== 0 || (e = e.dependencies, !!(e !== null && Ta(e)));
	}
	function hl(e, t, n) {
		switch (t.tag) {
			case 3:
				Ne(t, t.stateNode.containerInfo), ba(t, Na, e.memoizedState.cache), ma();
				break;
			case 27:
			case 5:
				A(t);
				break;
			case 4:
				Ne(t, t.stateNode.containerInfo);
				break;
			case 10:
				ba(t, t.type, t.memoizedProps.value);
				break;
			case 31:
				if (t.memoizedState !== null) return t.flags |= 128, Io(t), null;
				break;
			case 13:
				var r = t.memoizedState;
				if (r !== null) {
					if (r.dehydrated !== null) return Fo(t), t.flags |= 128, null;
					r = wa(e, t, n, !1);
					var i = t.child.childLanes;
					return r || (n & i) !== 0 ? nl(e, t, n) : (Fo(t), e = pl(e, t, n), e === null ? null : e.sibling);
				}
				Fo(t);
				break;
			case 19:
				if (t.flags & 128) return dl(e, t, n);
				if (i = !!(e.flags & 128), r = (n & t.childLanes) !== 0, r ||= (wa(e, t, n, !1), (n & t.childLanes) !== 0), i) {
					if (r) return dl(e, t, n);
					t.flags |= 128;
				}
				if (i = t.memoizedState, i !== null && (i.rendering = null, i.tail = null, i.lastEffect = null), Vo(t, Bo.current), r) break;
				return null;
			case 22: return t.lanes = 0, Hc(e, t, n, t.pendingProps);
			case 24: ba(t, Na, e.memoizedState.cache);
		}
		return pl(e, t, n);
	}
	function gl(e, t, n) {
		if (e !== null) {
			if (e.memoizedProps !== t.pendingProps) Lc = !0;
			else {
				if (!ml(e, n) && !(t.flags & 128)) return Lc = !1, hl(e, t, n);
				Lc = !!(e.flags & 131072);
			}
		} else Lc = !1, R && t.flags & 1048576 && na(t, Xi, t.index);
		switch (t.lanes = 0, t.tag) {
			case 16:
				a: {
					var r = t.pendingProps;
					if (e = ro(t.elementType), t.type = e, typeof e == "function") Ri(e) ? (r = Ec(e, r), t.tag = 1, t = Zc(null, t, e, r, n)) : (t.tag = 0, t = Yc(null, t, e, r, n));
					else {
						if (e != null) {
							var a = e.$$typeof;
							if (a === ce) {
								t.tag = 11, t = zc(null, t, e, r, n);
								break a;
							}
							if (a === de) {
								t.tag = 14, t = Bc(null, t, e, r, n);
								break a;
							}
							if (a === se) {
								t.tag = 10, t.type = e, t = fl(null, t, n);
								break a;
							}
						}
						throw t = xe(e) || e, Error(i(306, t, ""));
					}
				}
				return t;
			case 0: return Yc(e, t, t.type, t.pendingProps, n);
			case 1: return r = t.type, a = Ec(r, t.pendingProps), Zc(e, t, r, a, n);
			case 3:
				a: {
					if (Ne(t, t.stateNode.containerInfo), e === null) throw Error(i(387));
					r = t.pendingProps;
					var o = t.memoizedState;
					a = o.element, vo(e, t), To(t, r, null, n);
					var s = t.memoizedState;
					if (r = s.cache, ba(t, Na, r), r !== o.cache && Ca(t, [Na], n, !0), wo(), r = s.element, o.isDehydrated) {
						if (o = {
							element: r,
							isDehydrated: !1,
							cache: s.cache
						}, t.updateQueue.baseState = o, t.memoizedState = o, t.flags & 256) {
							t = Qc(e, t, r, n);
							break a;
						}
						if (r !== a) {
							a = F(Error(i(424)), t), ga(a), t = Qc(e, t, r, n);
							break a;
						}
						switch (e = t.stateNode.containerInfo, e.nodeType) {
							case 9:
								e = e.body;
								break;
							default: e = e.nodeName === "HTML" ? e.ownerDocument.body : e;
						}
						for (oa = bm(e.firstChild), aa = t, R = !0, sa = null, ca = !0, n = ho(t, null, r, n), t.child = n; n;) n.flags = n.flags & -3 | 134221824, n = n.sibling;
					} else {
						if (ma(), r === a) {
							t = pl(e, t, n);
							break a;
						}
						Rc(e, t, r, n);
					}
					t = t.child;
				}
				return t;
			case 26: return Jc(e, t), e === null ? (n = Um(t.type, null, t.pendingProps, null)) ? t.memoizedState = n : R || (t.stateNode = Cp(t.type, t.pendingProps, je.current, t)) : t.memoizedState = Um(t.type, e.memoizedProps, t.pendingProps, e.memoizedState), null;
			case 27: return A(t), e === null && R && (r = t.stateNode = Em(t.type, t.pendingProps, je.current), aa = t, ca = !0, a = oa, Np(t.type) ? (xm = a, oa = bm(r.firstChild)) : oa = a), Rc(e, t, t.pendingProps.children, n), Jc(e, t), e === null && (t.flags |= 4194304), t.child;
			case 5: return e === null && R && ((a = r = oa) && (r = mm(r, t.type, t.pendingProps, ca), r === null ? a = !1 : (t.stateNode = r, aa = t, oa = bm(r.firstChild), ca = !1, a = !0)), a || ua(t)), A(t), a = t.type, o = t.pendingProps, s = e === null ? null : e.memoizedProps, r = o.children, wp(a, o) ? r = null : s !== null && wp(a, s) && (t.flags |= 32), t.memoizedState !== null && (a = ns(e, t, as, null, null, n), gh._currentValue = a), Jc(e, t), Rc(e, t, r, n), t.child;
			case 6: return e === null && R && ((e = n = oa) && (n = hm(n, t.pendingProps, ca), n === null ? e = !1 : (t.stateNode = n, aa = t, oa = null, e = !0)), e || ua(t)), null;
			case 13: return nl(e, t, n);
			case 4: return Ne(t, t.stateNode.containerInfo), r = t.pendingProps, e === null ? t.child = mo(t, null, r, n) : Rc(e, t, r, n), t.child;
			case 11: return zc(e, t, t.type, t.pendingProps, n);
			case 7: return r = t.pendingProps, Jc(e, t), Rc(e, t, r, n), t.child;
			case 8: return Rc(e, t, t.pendingProps.children, n), t.child;
			case 12: return Rc(e, t, t.pendingProps.children, n), t.child;
			case 10: return fl(e, t, n);
			case 9: return a = t.type._context, r = t.pendingProps.children, Ea(t), a = Da(a), r = r(a), t.flags |= 1, Rc(e, t, r, n), t.child;
			case 14: return Bc(e, t, t.type, t.pendingProps, n);
			case 15: return Vc(e, t, t.type, t.pendingProps, n);
			case 19: return dl(e, t, n);
			case 31: return qc(e, t, n);
			case 22: return Hc(e, t, n, t.pendingProps);
			case 24: return Ea(t), r = Da(Na), e === null ? (a = Ja(), a === null && (a = sd, o = Pa(), a.pooledCache = o, o.refCount++, o !== null && (a.pooledCacheLanes |= n), a = o), t.memoizedState = {
				parent: r,
				cache: a
			}, _o(t), ba(t, Na, a)) : ((e.lanes & n) !== 0 && (vo(e, t), To(t, null, null, n), wo()), a = e.memoizedState, o = t.memoizedState, a.parent === r ? (r = o.cache, ba(t, Na, r), r !== a.cache && Ca(t, [Na], n, !0)) : (a = {
				parent: r,
				cache: r
			}, t.memoizedState = a, t.lanes === 0 && (t.memoizedState = t.updateQueue.baseState = a), ba(t, Na, r))), Rc(e, t, t.pendingProps.children, n), t.child;
			case 30: return t.stateNode === null && (t.stateNode = {
				autoName: null,
				paired: null,
				clones: null,
				ref: null
			}), r = t.pendingProps, r.name != null && r.name !== "auto" ? t.flags |= e === null ? 18882560 : 18874368 : R && L(t), e !== null && e.memoizedProps.name !== r.name ? t.flags |= 4194816 : Jc(e, t), Rc(e, t, r.children, n), t.child;
			case 29: throw t.pendingProps;
		}
		throw Error(i(156, t.tag));
	}
	function _l(e) {
		e.flags |= 4;
	}
	function vl(e, t, n, r, i) {
		var a;
		if ((a = !!(e.mode & 32)) && (a = n === null ? rh(t, r) : rh(t, r) && (r.src !== n.src || r.srcSet !== n.srcSet)), a) {
			if (e.flags |= 16777216, (i & 335544128) === i) {
				if (e.stateNode.complete) e.flags |= 8192;
				else if (Qd()) e.flags |= 8192;
				else throw io = eo, Qa;
			}
		} else e.flags &= -16777217;
	}
	function yl(e, t) {
		if (t.type !== "stylesheet" || t.state.loading & 4) e.flags &= -16777217;
		else if (e.flags |= 16777216, !ih(t)) {
			if (Qd()) e.flags |= 8192;
			else throw io = eo, Qa;
		}
	}
	function bl(e, t) {
		t !== null && (e.flags |= 4), e.flags & 16384 && (t = e.tag === 22 ? 536870912 : vt(), e.lanes |= t, yd |= t);
	}
	function xl(e, t) {
		if (!R) switch (e.tailMode) {
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
	function Sl(e) {
		var t = e.alternate !== null && e.alternate.child === e.child, n = 0, r = 0;
		if (t) for (var i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags & 1206910976, r |= i.flags & 1206910976, i.return = e, i = i.sibling;
		else for (i = e.child; i !== null;) n |= i.lanes | i.childLanes, r |= i.subtreeFlags, r |= i.flags, i.return = e, i = i.sibling;
		return e.subtreeFlags |= r, e.childLanes = n, t;
	}
	function Cl(e, t, n) {
		var r = t.pendingProps;
		switch (ra(t), t.tag) {
			case 16:
			case 15:
			case 0:
			case 11:
			case 7:
			case 8:
			case 12:
			case 9:
			case 14: return Sl(t), null;
			case 1: return Sl(t), null;
			case 3: return n = t.stateNode, r = null, e !== null && (r = e.memoizedState.cache), t.memoizedState.cache !== r && (t.flags |= 2048), xa(Na), Pe(), n.pendingContext && (n.context = n.pendingContext, n.pendingContext = null), (e === null || e.child === null) && (pa(t) ? _l(t) : e === null || e.memoizedState.isDehydrated && !(t.flags & 256) || (t.flags |= 1024, ha())), Sl(t), null;
			case 26:
				var a = t.type, o = t.memoizedState;
				return e === null ? (_l(t), o === null ? (Sl(t), vl(t, a, null, r, n)) : (Sl(t), yl(t, o))) : o ? o === e.memoizedState ? (Sl(t), t.flags &= -16777217) : (_l(t), Sl(t), yl(t, o)) : (e = e.memoizedProps, e !== r && _l(t), Sl(t), vl(t, a, e, r, n)), null;
			case 27:
				if (Fe(t), n = je.current, a = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && _l(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(i(166));
						return Sl(t), t.subtreeFlags &= -33554433, null;
					}
					e = ke.current, pa(t) ? da(t, e) : (e = Em(a, r, n), t.stateNode = e, _l(t));
				}
				return Sl(t), t.subtreeFlags &= -33554433, null;
			case 5:
				if (Fe(t), a = t.type, e !== null && t.stateNode != null) e.memoizedProps !== r && _l(t);
				else {
					if (!r) {
						if (t.stateNode === null) throw Error(i(166));
						return Sl(t), t.subtreeFlags &= -33554433, null;
					}
					if (o = ke.current, pa(t)) da(t, o);
					else {
						var s = bp(je.current);
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
						o[At] = t, o[jt] = r;
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
						a: switch (pp(o, a, r), a) {
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
						r && _l(t);
					}
				}
				return Sl(t), t.subtreeFlags &= -33554433, vl(t, t.type, e === null ? null : e.memoizedProps, t.pendingProps, n), null;
			case 6:
				if (e && t.stateNode != null) e.memoizedProps !== r && _l(t);
				else {
					if (typeof r != "string" && t.stateNode === null) throw Error(i(166));
					if (e = je.current, pa(t)) {
						if (e = t.stateNode, n = t.memoizedProps, r = null, a = aa, a !== null) switch (a.tag) {
							case 27:
							case 5: r = a.memoizedProps;
						}
						e[At] = t, e = !!(e.nodeValue === n || r !== null && !0 === r.suppressHydrationWarning || up(e.nodeValue, n)), e || ua(t, !0);
					} else e = bp(e).createTextNode(r), e[At] = t, t.stateNode = e;
				}
				return Sl(t), null;
			case 31:
				if (n = t.memoizedState, e === null || e.memoizedState !== null) {
					if (r = pa(t), n !== null) {
						if (e === null) {
							if (!r) throw Error(i(318));
							if (e = t.memoizedState, e = e === null ? null : e.dehydrated, !e) throw Error(i(557));
							e[At] = t;
						} else ma(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						Sl(t), e = !1;
					} else n = ha(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = n), e = !0;
					if (!e) return t.flags & 256 ? (zo(t), t) : (zo(t), null);
					if (t.flags & 128) throw Error(i(558));
				}
				return Sl(t), null;
			case 13:
				if (r = t.memoizedState, e === null || e.memoizedState !== null && e.memoizedState.dehydrated !== null) {
					if (a = pa(t), r !== null && r.dehydrated !== null) {
						if (e === null) {
							if (!a) throw Error(i(318));
							if (a = t.memoizedState, a = a === null ? null : a.dehydrated, !a) throw Error(i(317));
							a[At] = t;
						} else ma(), !(t.flags & 128) && (t.memoizedState = null), t.flags |= 4;
						Sl(t), a = !1;
					} else a = ha(), e !== null && e.memoizedState !== null && (e.memoizedState.hydrationErrors = a), a = !0;
					if (!a) return t.flags & 256 ? (zo(t), t) : (zo(t), null);
				}
				return zo(t), t.flags & 128 ? (t.lanes = n, t) : (n = r !== null, e = e !== null && e.memoizedState !== null, n && (r = t.child, a = null, r.alternate !== null && r.alternate.memoizedState !== null && r.alternate.memoizedState.cachePool !== null && (a = r.alternate.memoizedState.cachePool.pool), o = null, r.memoizedState !== null && r.memoizedState.cachePool !== null && (o = r.memoizedState.cachePool.pool), o !== a && (r.flags |= 2048)), n !== e && n && (t.child.flags |= 8192), bl(t, t.updateQueue), Sl(t), null);
			case 4: return Pe(), e === null && ep(t.stateNode.containerInfo), t.flags |= 67108864, Sl(t), null;
			case 10: return xa(t.type), Sl(t), null;
			case 19:
				if (Ho(t), r = t.memoizedState, r === null) return Sl(t), null;
				if (a = !!(t.flags & 128), o = r.rendering, o === null) {
					if (a) xl(r, !1);
					else {
						if (md !== 0 || e !== null && e.flags & 128) for (e = t.child; e !== null;) {
							if (o = Uo(e), o !== null) {
								for (t.flags |= 128, xl(r, !1), e = o.updateQueue, t.updateQueue = e, bl(t, e), t.subtreeFlags = 0, e = n, n = t.child; n !== null;) Bi(n, e), n = n.sibling;
								return Vo(t, Bo.current & 1 | 2), R && I(t, r.treeForkCount), t.child;
							}
							e = e.sibling;
						}
						r.tail !== null && Je() > Td && (t.flags |= 128, a = !0, xl(r, !1), t.lanes = 4194304);
					}
				} else {
					if (!a) {
						if (e = Uo(o), e !== null) {
							if (t.flags |= 128, a = !0, e = e.updateQueue, t.updateQueue = e, bl(t, e), xl(r, !0), r.tail === null && r.tailMode !== "collapsed" && r.tailMode !== "visible" && !o.alternate && !R) return Sl(t), null;
						} else 2 * Je() - r.renderingStartTime > Td && n !== 536870912 && (t.flags |= 128, a = !0, xl(r, !1), t.lanes = 4194304);
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
					return r.rendering = e, r.tail = e.sibling, r.renderingStartTime = Je(), e.sibling = null, o = Bo.current, o = a ? o & 1 | 2 : o & 1, r.tailMode === "visible" || r.tailMode === "collapsed" || !n || R ? Vo(t, o) : (n = o, Oe(No, t), Oe(Bo, n), Po === null && (Po = t)), R && I(t, r.treeForkCount), e;
				}
				return Sl(t), null;
			case 22:
			case 23: return zo(t), Mo(), r = t.memoizedState !== null, e === null ? r && (t.flags |= 8192) : e.memoizedState !== null !== r && (t.flags |= 8192), r ? n & 536870912 && !(t.flags & 128) && (Sl(t), t.subtreeFlags & 6 && (t.flags |= 8192)) : Sl(t), n = t.updateQueue, n !== null && bl(t, n.retryQueue), n = null, e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), r = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (r = t.memoizedState.cachePool.pool), r !== n && (t.flags |= 2048), e !== null && De(qa), null;
			case 24: return n = null, e !== null && (n = e.memoizedState.cache), t.memoizedState.cache !== n && (t.flags |= 2048), xa(Na), Sl(t), null;
			case 25: return null;
			case 30: return t.flags |= 33554432, Sl(t), null;
		}
		throw Error(i(156, t.tag));
	}
	function wl(e, t) {
		switch (ra(t), t.tag) {
			case 1: return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 3: return xa(Na), Pe(), e = t.flags, e & 65536 && !(e & 128) ? (t.flags = e & -65537 | 128, t) : null;
			case 26:
			case 27:
			case 5: return Fe(t), null;
			case 31:
				if (t.memoizedState !== null) {
					if (zo(t), t.alternate === null) throw Error(i(340));
					ma();
				}
				return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 13:
				if (zo(t), e = t.memoizedState, e !== null && e.dehydrated !== null) {
					if (t.alternate === null) throw Error(i(340));
					ma();
				}
				return e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 19: return Ho(t), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, e = t.memoizedState, e !== null && (e.rendering = null, e.tail = null), t.flags |= 4, t) : null;
			case 4: return Pe(), null;
			case 10: return xa(t.type), null;
			case 22:
			case 23: return zo(t), Mo(), e !== null && De(qa), e = t.flags, e & 65536 ? (t.flags = e & -65537 | 128, t) : null;
			case 24: return xa(Na), null;
			case 25: return null;
			default: return null;
		}
	}
	function Tl(e, t) {
		switch (ra(t), t.tag) {
			case 3:
				xa(Na), Pe();
				break;
			case 26:
			case 27:
			case 5:
				Fe(t);
				break;
			case 4:
				Pe();
				break;
			case 31:
				t.memoizedState !== null && zo(t);
				break;
			case 13:
				zo(t);
				break;
			case 19:
				Ho(t);
				break;
			case 10:
				xa(t.type);
				break;
			case 22:
			case 23:
				zo(t), Mo(), e !== null && De(qa);
				break;
			case 24: xa(Na);
		}
	}
	function El(e, t) {
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
			Cf(t, t.return, e);
		}
	}
	function Dl(e, t, n) {
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
								Cf(i, c, e);
							}
						}
					}
					r = r.next;
				} while (r !== a);
			}
		} catch (e) {
			Cf(t, t.return, e);
		}
	}
	function Ol(e) {
		var t = e.updateQueue;
		if (t !== null) {
			var n = e.stateNode;
			try {
				Do(t, n);
			} catch (t) {
				Cf(e, e.return, t);
			}
		}
	}
	function kl(e, t, n) {
		n.props = Ec(e.type, e.memoizedProps), n.state = e.memoizedState;
		try {
			n.componentWillUnmount();
		} catch (n) {
			Cf(e, t, n);
		}
	}
	function Al(e, t) {
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
						var i = e.stateNode, a = Si(e.memoizedProps, i);
						(i.ref === null || i.ref.name !== a) && (i.ref = Gp(a)), r = i.ref;
						break;
					case 7:
						if (e.stateNode === null) {
							var o = new Kp(e);
							h(e.child, !1, lm, o, void 0, void 0), e.stateNode = o;
						}
						r = e.stateNode;
						break;
					default: r = e.stateNode;
				}
				typeof n == "function" ? e.refCleanup = n(r) : n.current = r;
			}
		} catch (n) {
			Cf(e, t, n);
		}
	}
	function jl(e, t) {
		var n = e.ref, r = e.refCleanup;
		if (n !== null) {
			if (typeof r == "function") try {
				r();
			} catch (n) {
				Cf(e, t, n);
			} finally {
				e.refCleanup = null, e = e.alternate, e != null && (e.refCleanup = null);
			}
			else if (typeof n == "function") try {
				n(null);
			} catch (n) {
				Cf(e, t, n);
			}
			else n.current = null;
		}
	}
	function Ml(e, t) {
		if ((e.tag === 5 || e.tag === 27 || e.tag === 6) && e.alternate === null && t !== null) for (var n = 0; n < t.length; n++) dm(e.stateNode, t[n]);
	}
	function Nl(e) {
		for (var t = e.return; t !== null && (Il(t) && dm(e.stateNode, t.stateNode), !Fl(t));) t = t.return;
	}
	function Pl(e) {
		for (var t = e.return; t !== null && (Il(t) && fm(e.stateNode, t.stateNode), !Fl(t));) t = t.return;
	}
	function Fl(e) {
		return e.tag === 5 || e.tag === 3 || e.tag === 27;
	}
	function Il(e) {
		return e && e.tag === 7 && e.stateNode !== null;
	}
	function Ll(e) {
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
			Cf(e, e.return, t);
		}
	}
	function Rl(e, t, n) {
		try {
			var r = e.stateNode;
			hp(r, e.type, n, t), r[jt] = t;
		} catch (t) {
			Cf(e, e.return, t);
		}
	}
	function zl(e) {
		return e.tag === 5 || e.tag === 3 || e.tag === 26 || e.tag === 27 && Np(e.type) || e.tag === 4;
	}
	function Bl(e) {
		a: for (;;) {
			for (; e.sibling === null;) {
				if (e.return === null || zl(e.return)) return null;
				e = e.return;
			}
			for (e.sibling.return = e.return, e = e.sibling; e.tag !== 5 && e.tag !== 6 && e.tag !== 18;) {
				if (e.tag === 27 && Np(e.type) || e.flags & 2 || e.child === null || e.tag === 4) continue a;
				e.child.return = e, e = e.child;
			}
			if (!(e.flags & 2)) return e.stateNode;
		}
	}
	function Vl(e, t, n, r) {
		var i = e.tag;
		if (i === 5 || i === 6) i = e.stateNode, t ? (n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n).insertBefore(i, t) : (t = n.nodeType === 9 ? n.body : n.nodeName === "HTML" ? n.ownerDocument.body : n, t.appendChild(i), n = n._reactRootContainer, n != null || t.onclick !== null || (t.onclick = En)), Ml(e, r), en = !0;
		else if (i !== 4 && (i === 27 && (Ml(e, r), r = null, Np(e.type) && (n = e.stateNode, t = null)), e = e.child, e !== null)) for (Vl(e, t, n, r), e = e.sibling; e !== null;) Vl(e, t, n, r), e = e.sibling;
	}
	function Hl(e, t, n, r) {
		var i = e.tag;
		if (i === 5 || i === 6) i = e.stateNode, t ? n.insertBefore(i, t) : n.appendChild(i), Ml(e, r), en = !0;
		else if (i !== 4 && (i === 27 && (Ml(e, r), r = null, Np(e.type) && (n = e.stateNode)), e = e.child, e !== null)) for (Hl(e, t, n, r), e = e.sibling; e !== null;) Hl(e, t, n, r), e = e.sibling;
	}
	function Ul(e) {
		var t = e.stateNode, n = e.memoizedProps;
		try {
			for (var r = e.type, i = t.attributes; i.length;) t.removeAttributeNode(i[0]);
			pp(t, r, n), t[At] = e, t[jt] = n;
		} catch (t) {
			Cf(e, e.return, t);
		}
	}
	var Wl = !1, Gl = null;
	function Kl(e) {
		(e.tag === 30 || e.subtreeFlags & 33554432) && (Wl = !0);
	}
	var ql = null;
	function Jl() {
		var e = ql;
		return ql = null, e;
	}
	var Yl = 0;
	function Xl(e, t, n, r, i) {
		return Yl = 0, Zl(e.child, t, n, r, i);
	}
	function Zl(e, t, n, r, i) {
		for (var a = !1; e !== null;) {
			if (e.tag === 5) {
				var o = e.stateNode;
				if (r !== null) {
					var s = zp(o);
					r.push(s), s.view && (a = !0);
				} else a || zp(o).view && (a = !0);
				Wl = !0, Ip(o, Yl === 0 ? t : t + "_" + Yl, n), Yl++;
			} else (e.tag !== 22 || e.memoizedState === null) && (e.tag === 30 && i || Zl(e.child, t, n, r, i) && (a = !0));
			e = e.sibling;
		}
		return a;
	}
	function Ql(e, t) {
		for (; e !== null;) e.tag === 5 ? Lp(e.stateNode, e.memoizedProps) : (e.tag !== 22 || e.memoizedState === null) && (e.tag === 30 && t || Ql(e.child, t)), e = e.sibling;
	}
	function $l(e) {
		if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
			if ((e.tag !== 22 || e.memoizedState === null) && ($l(e), e.tag === 30 && e.flags & 18874368 && e.stateNode.paired)) {
				var t = e.memoizedProps;
				if (t.name == null || t.name === "auto") throw Error(i(544));
				var n = t.name;
				t = wi(t.default, t.share), t !== "none" && (Xl(e, n, t, null, !1) || Ql(e.child, !1));
			}
			e = e.sibling;
		}
	}
	function eu(e, t) {
		if (e.tag === 30) {
			var n = e.stateNode, r = e.memoizedProps, i = Si(r, n), a = wi(r.default, n.paired ? r.share : r.enter);
			a === "none" ? $l(e) : Xl(e, i, a, null, !1) ? ($l(e), n.paired || t || Hd(e, r.onEnter)) : Ql(e.child, !1);
		} else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) eu(e, t), e = e.sibling;
		else $l(e);
	}
	function tu(e) {
		if (Gl !== null && Gl.size !== 0) {
			var t = Gl;
			if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
				if (e.tag !== 22 || e.memoizedState === null) {
					if (e.tag === 30 && e.flags & 18874368) {
						var n = e.memoizedProps, r = n.name;
						if (r != null && r !== "auto") {
							var i = t.get(r);
							if (i !== void 0) {
								var a = wi(n.default, n.share);
								if (a !== "none" && (Xl(e, r, a, null, !1) ? (a = e.stateNode, i.paired = a, a.paired = i, Hd(e, n.onShare)) : Ql(e.child, !1)), t.delete(r), t.size === 0) break;
							}
						}
					}
					tu(e);
				}
				e = e.sibling;
			}
		}
	}
	function nu(e) {
		if (e.tag === 30) {
			var t = e.memoizedProps, n = Si(t, e.stateNode), r = Gl === null ? void 0 : Gl.get(n), i = wi(t.default, r === void 0 ? t.exit : t.share);
			i !== "none" && (Xl(e, n, i, null, !1) ? r === void 0 ? Hd(e, t.onExit) : (i = e.stateNode, r.paired = i, i.paired = r, Gl.delete(n), Hd(e, t.onShare)) : Ql(e.child, !1)), Gl !== null && tu(e);
		} else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) nu(e), e = e.sibling;
		else Gl !== null && tu(e);
	}
	function ru(e) {
		for (e = e.child; e !== null;) {
			if (e.tag === 30) {
				var t = e.memoizedProps, n = Si(t, e.stateNode);
				t = wi(t.default, t.update), e.flags &= -5, t !== "none" && Xl(e, n, t, e.memoizedState = [], !1);
			} else e.subtreeFlags & 33554432 && ru(e);
			e = e.sibling;
		}
	}
	function iu(e) {
		if (e.subtreeFlags & 18874368) for (e = e.child; e !== null;) {
			if (e.tag !== 22 || e.memoizedState === null) {
				if (e.tag === 30 && e.flags & 18874368) {
					var t = e.stateNode;
					t.paired !== null && (t.paired = null, Ql(e.child, !1));
				}
				iu(e);
			}
			e = e.sibling;
		}
	}
	function au(e) {
		if (e.tag === 30) e.stateNode.paired = null, Ql(e.child, !1), iu(e);
		else if (e.subtreeFlags & 33554432) for (e = e.child; e !== null;) au(e), e = e.sibling;
		else iu(e);
	}
	function ou(e) {
		for (e = e.child; e !== null;) e.tag === 30 ? Ql(e.child, !1) : e.subtreeFlags & 33554432 && ou(e), e = e.sibling;
	}
	function su(e, t, n, r, i, a, o) {
		for (var s = !1; t !== null;) {
			if (t.tag === 5) {
				var c = t.stateNode;
				if (a !== null && Yl < a.length) {
					var l = a[Yl], u = zp(c);
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
				e.flags & 4 && Ip(c, Yl === 0 ? n : n + "_" + Yl, i), s && e.flags & 4 || (ql === null && (ql = []), ql.push(c, Yl === 0 ? r : r + "_" + Yl, t.memoizedProps)), Yl++;
			} else (t.tag !== 22 || t.memoizedState === null) && (t.tag === 30 && o ? e.flags |= t.flags & 32 : su(e, t.child, n, r, i, a, o) && (s = !0));
			t = t.sibling;
		}
		return s;
	}
	function cu(e, t) {
		for (e = e.child; e !== null;) {
			if (e.tag === 30) {
				var n = e.memoizedProps, r = e.stateNode, i = Si(n, r), a = wi(n.default, n.update);
				if (t) {
					r = r.clones;
					var o = r === null ? null : r.map(Bp);
				} else o = e.memoizedState, e.memoizedState = null;
				r = e;
				var s = e.child;
				Yl = 0, i = su(r, s, i, i, a, o, !1), e.flags & 4 && i && (t || Hd(e, n.onUpdate));
			} else e.subtreeFlags & 33554432 && cu(e, t);
			e = e.sibling;
		}
	}
	var lu = !1, uu = !1, du = !1, fu = !1, pu = typeof WeakSet == "function" ? WeakSet : Set, mu = null, hu = !1, gu = !1, _u = !1, vu = !1;
	function yu(e, t, n) {
		if (e = e.containerInfo, vp = Th, e = Qr(e), $r(e)) {
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
		for (yp = {
			focusedElem: e,
			selectionRange: r
		}, Th = !1, n = (n & 335544064) === n, mu = t, t = n ? 9270 : 1024; mu !== null;) {
			if (e = mu, n && (r = e.deletions, r !== null)) for (a = 0; a < r.length; a++) n && nu(r[a]);
			if (e.alternate === null && e.flags & 2) n && Kl(e), bu(n);
			else {
				if (e.tag === 22) {
					if (r = e.alternate, e.memoizedState !== null) {
						r !== null && r.memoizedState === null && n && nu(r), bu(n);
						continue;
					}
					if (r !== null && r.memoizedState !== null) {
						n && Kl(e), bu(n);
						continue;
					}
				}
				r = e.child, (e.subtreeFlags & t) !== 0 && r !== null ? (r.return = e, mu = r) : (n && ru(e), bu(n));
			}
		}
		Gl = null;
	}
	function bu(e) {
		for (; mu !== null;) {
			var t = mu, n = e, r = t.alternate, a = t.flags;
			switch (t.tag) {
				case 0:
				case 11:
				case 15: break;
				case 1:
					if (a & 1024 && r !== null) {
						n = void 0, a = r.memoizedProps, r = r.memoizedState;
						var o = t.stateNode;
						try {
							var s = Ec(t.type, a);
							n = o.getSnapshotBeforeUpdate(s, r), o.__reactInternalSnapshotBeforeUpdate = n;
						} catch (e) {
							Cf(t, t.return, e);
						}
					}
					break;
				case 3:
					if (a & 1024) {
						if (r = t.stateNode.containerInfo, n = r.nodeType, n === 9) pm(r);
						else if (n === 1) switch (r.nodeName) {
							case "HEAD":
							case "HTML":
							case "BODY":
								pm(r);
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
					n && r !== null && (n = Si(r.memoizedProps, r.stateNode), a = t.memoizedProps, a = wi(a.default, a.update), a !== "none" && Xl(r, n, a, r.memoizedState = [], !0));
					break;
				default: if (a & 1024) throw Error(i(163));
			}
			if (r = t.sibling, r !== null) {
				r.return = t.return, mu = r;
				break;
			}
			mu = t.return;
		}
	}
	function xu(e, t, n) {
		var r = n.flags;
		switch (n.tag) {
			case 0:
			case 11:
			case 15:
				Vu(e, n), r & 4 && El(5, n);
				break;
			case 1:
				if (Vu(e, n), r & 4) {
					if (e = n.stateNode, t === null) try {
						e.componentDidMount();
					} catch (e) {
						Cf(n, n.return, e);
					}
					else {
						var i = Ec(n.type, t.memoizedProps);
						t = t.memoizedState;
						try {
							e.componentDidUpdate(i, t, e.__reactInternalSnapshotBeforeUpdate);
						} catch (e) {
							Cf(n, n.return, e);
						}
					}
				}
				r & 64 && Ol(n), r & 512 && Al(n, n.return);
				break;
			case 3:
				if (Vu(e, n), r & 64 && (e = n.updateQueue, e !== null)) {
					if (t = null, n.child !== null) switch (n.child.tag) {
						case 27:
						case 5:
							t = n.child.stateNode;
							break;
						case 1: t = n.child.stateNode;
					}
					try {
						Do(e, t);
					} catch (e) {
						Cf(n, n.return, e);
					}
				}
				break;
			case 27: t === null && r & 4 && Ul(n);
			case 26:
			case 5:
				Vu(e, n), t === null && r & 4 && Ll(n), r & 512 && Al(n, n.return);
				break;
			case 12:
				Vu(e, n);
				break;
			case 31:
				Vu(e, n), r & 4 && Au(e, n);
				break;
			case 13:
				Vu(e, n), r & 4 && ju(e, n), r & 64 && (e = n.memoizedState, e !== null && (e = e.dehydrated, e !== null && (n = Df.bind(null, n), ym(e, n))));
				break;
			case 22:
				if (r = n.memoizedState !== null || lu, !r) {
					var a = t !== null && t.memoizedState !== null || uu;
					t = lu, i = uu, lu = r, (uu = a) && !i ? (r = 2, n.subtreeFlags & 8772 && (r |= 1), Uu(e, n, r)) : Vu(e, n), lu = t, uu = i;
				}
				break;
			case 30:
				Vu(e, n), r & 512 && Al(n, n.return);
				break;
			case 7: r & 512 && Al(n, n.return);
			default: Vu(e, n);
		}
	}
	function Su(e, t) {
		for (e = e.child; e !== null;) Cu(e, t), e = e.sibling;
	}
	function Cu(e, t) {
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
					Cf(e, e.return, t);
				}
				wu(e, t);
				break;
			case 6:
				try {
					e.stateNode.nodeValue = t ? "" : e.memoizedProps, en = !0;
				} catch (t) {
					Cf(e, e.return, t);
				}
				break;
			case 18:
				try {
					var s = e.stateNode;
					t ? Fp(s, !0) : Fp(e.stateNode, !1);
				} catch (t) {
					Cf(e, e.return, t);
				}
				break;
			case 22:
			case 23:
				e.memoizedState === null && Su(e, t);
				break;
			default: Su(e, t);
		}
	}
	function wu(e, t) {
		if (e.subtreeFlags & 67108864) for (e = e.child; e !== null;) {
			a: {
				var n = e, r = t;
				switch (n.tag) {
					case 4:
						Cu(n, r);
						break a;
					case 22:
						n.memoizedState === null && wu(n, r);
						break a;
					default: wu(n, r);
				}
			}
			e = e.sibling;
		}
	}
	function Tu(e) {
		var t = e.alternate;
		t !== null && (e.alternate = null, Tu(t)), e.child = null, e.deletions = null, e.sibling = null, e.tag === 5 && (t = e.stateNode, t !== null && zt(t)), e.stateNode = null, e.return = null, e.dependencies = null, e.memoizedProps = null, e.memoizedState = null, e.pendingProps = null, e.stateNode = null, e.updateQueue = null;
	}
	var Eu = null, Du = !1;
	function Ou(e, t, n) {
		for (n = n.child; n !== null;) ku(e, t, n), n = n.sibling;
	}
	function ku(e, t, n) {
		if (it && typeof it.onCommitFiberUnmount == "function") try {
			it.onCommitFiberUnmount(rt, n);
		} catch {}
		switch (n.tag) {
			case 26:
				uu || jl(n, t), Ou(e, t, n), n.memoizedState ? n.memoizedState.count-- : n.stateNode && !uu && (n = n.stateNode, n.parentNode.removeChild(n));
				break;
			case 27:
				uu || jl(n, t), Pl(n);
				var r = Eu, i = Du;
				Np(n.type) && (Eu = n.stateNode, Du = !1), Ou(e, t, n), Dm(n.stateNode, n.type, n.memoizedProps), Eu = r, Du = i;
				break;
			case 5: uu || jl(n, t), Pl(n);
			case 6:
				if (n.tag === 6 && Pl(n), r = Eu, i = Du, Eu = null, Ou(e, t, n), Eu = r, Du = i, Eu !== null) {
					if (Du) try {
						(Eu.nodeType === 9 ? Eu.body : Eu.nodeName === "HTML" ? Eu.ownerDocument.body : Eu).removeChild(n.stateNode), en = !0;
					} catch (e) {
						Cf(n, t, e);
					}
					else try {
						Eu.removeChild(n.stateNode), en = !0;
					} catch (e) {
						Cf(n, t, e);
					}
				}
				break;
			case 18:
				Eu !== null && (Du ? (e = Eu, Pp(e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, n.stateNode), qh(e)) : Pp(Eu, n.stateNode));
				break;
			case 4:
				r = Eu, i = Du, Eu = n.stateNode.containerInfo, Du = !0, Ou(e, t, n), Eu = r, Du = i;
				break;
			case 0:
			case 11:
			case 14:
			case 15:
				Dl(2, n, t), uu || Dl(4, n, t), Ou(e, t, n);
				break;
			case 1:
				uu || (jl(n, t), r = n.stateNode, typeof r.componentWillUnmount == "function" && kl(n, t, r)), Ou(e, t, n);
				break;
			case 21:
				Ou(e, t, n);
				break;
			case 22:
				uu = (r = uu) || n.memoizedState !== null, Ou(e, t, n), uu = r;
				break;
			case 30:
				jl(n, t), Ou(e, t, n);
				break;
			case 7:
				uu || jl(n, t), Ou(e, t, n);
				break;
			default: Ou(e, t, n);
		}
	}
	function Au(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null))) {
			e = e.dehydrated;
			try {
				qh(e);
			} catch (e) {
				Cf(t, t.return, e);
			}
		}
	}
	function ju(e, t) {
		if (t.memoizedState === null && (e = t.alternate, e !== null && (e = e.memoizedState, e !== null && (e = e.dehydrated, e !== null)))) try {
			qh(e);
		} catch (e) {
			Cf(t, t.return, e);
		}
	}
	function Mu(e) {
		switch (e.tag) {
			case 31:
			case 13:
			case 19:
				var t = e.stateNode;
				return t === null && (t = e.stateNode = new pu()), t;
			case 22: return e = e.stateNode, t = e._retryCache, t === null && (t = e._retryCache = new pu()), t;
			default: throw Error(i(435, e.tag));
		}
	}
	function Nu(e, t) {
		var n = Mu(e);
		t.forEach(function(t) {
			if (!n.has(t)) {
				n.add(t);
				var r = Of.bind(null, e, t);
				t.then(r, r);
			}
		});
	}
	function Pu(e, t, n) {
		var r = t.deletions;
		if (r !== null) for (var a = 0; a < r.length; a++) {
			var o = r[a], s = e, c = t, l = c;
			a: for (; l !== null;) {
				switch (l.tag) {
					case 27:
						if (Np(l.type)) {
							Eu = l.stateNode, Du = !1;
							break a;
						}
						break;
					case 5:
						Eu = l.stateNode, Du = !1;
						break a;
					case 3:
					case 4:
						Eu = l.stateNode.containerInfo, Du = !0;
						break a;
				}
				l = l.return;
			}
			if (Eu === null) throw Error(i(160));
			ku(s, c, o), Eu = null, Du = !1, s = o.alternate, s !== null && (s.return = null), o.return = null;
		}
		if (t.subtreeFlags & 13886) for (t = t.child; t !== null;) Iu(t, e, n), t = t.sibling;
	}
	var Fu = null;
	function Iu(e, t, n) {
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
				Pu(t, e, n), Lu(e), a & 4 && (Dl(3, e, e.return), El(3, e), Dl(5, e, e.return));
				break;
			case 1:
				Pu(t, e, n), Lu(e), a & 512 && (uu || r === null || jl(r, r.return)), a & 64 && lu && (e = e.updateQueue, e !== null && (t = e.callbacks, t !== null && (n = e.shared.hiddenCallbacks, e.shared.hiddenCallbacks = n === null ? t : n.concat(t))));
				break;
			case 26:
				if (o = Fu, Pu(t, e, n), Lu(e), a & 512 && (uu || r === null || jl(r, r.return)), a & 4) {
					if (a = r === null ? null : r.memoizedState, n = e.memoizedState, r === null) {
						if (n === null) {
							if (e.stateNode === null) {
								if (lu) e.stateNode = Cp(e.type, e.memoizedProps, t.containerInfo, e);
								else {
									a: {
										t = e.type, n = e.memoizedProps, a = o.ownerDocument || o;
										b: switch (t) {
											case "title":
												r = a.getElementsByTagName("title")[0], (!r || r[Lt] || r[At] || r.namespaceURI === "http://www.w3.org/2000/svg" || r.hasAttribute("itemprop")) && (r = a.createElement(t), a.head.insertBefore(r, a.querySelector("head > title"))), pp(r, t, n), r[At] = e, Wt(r), t = r;
												break a;
											case "link":
												if (o = eh("link", "href", a).get(t + (n.href || ""))) {
													for (s = 0; s < o.length; s++) if (r = o[s], r.getAttribute("href") === (n.href == null || n.href === "" ? null : n.href) && r.getAttribute("rel") === (n.rel == null ? null : n.rel) && r.getAttribute("title") === (n.title == null ? null : n.title) && r.getAttribute("crossorigin") === (n.crossOrigin == null ? null : n.crossOrigin)) {
														o.splice(s, 1);
														break b;
													}
												}
												r = a.createElement(t), pp(r, t, n), a.head.appendChild(r);
												break;
											case "meta":
												if (o = eh("meta", "content", a).get(t + (n.content || ""))) {
													for (s = 0; s < o.length; s++) if (r = o[s], r.getAttribute("content") === (n.content == null ? null : "" + n.content) && r.getAttribute("name") === (n.name == null ? null : n.name) && r.getAttribute("property") === (n.property == null ? null : n.property) && r.getAttribute("http-equiv") === (n.httpEquiv == null ? null : n.httpEquiv) && r.getAttribute("charset") === (n.charSet == null ? null : n.charSet)) {
														o.splice(s, 1);
														break b;
													}
												}
												r = a.createElement(t), pp(r, t, n), a.head.appendChild(r);
												break;
											default: throw Error(i(468, t));
										}
										r[At] = e, Wt(r), t = r;
									}
									e.stateNode = t;
								}
							} else lu || th(o, e.type, e.stateNode);
						} else e.stateNode = W(o, n, e.memoizedProps);
					} else a === n ? n === null && e.stateNode !== null && Rl(e, e.memoizedProps, r.memoizedProps) : (a === null ? (t = r.stateNode, t === null || uu || t.parentNode.removeChild(t)) : a.count--, n === null ? lu || th(o, e.type, e.stateNode) : W(o, n, e.memoizedProps));
				}
				break;
			case 27:
				Pu(t, e, n), Lu(e), a & 512 && (uu || r === null || jl(r, r.return)), r !== null && a & 4 && Rl(e, e.memoizedProps, r.memoizedProps);
				break;
			case 5:
				if (o = du, du = !1, Pu(t, e, n), du = o, Lu(e), a & 512 && (uu || r === null || jl(r, r.return)), e.flags & 32) {
					t = e.stateNode;
					try {
						vn(t, ""), en = !0;
					} catch (t) {
						Cf(e, e.return, t);
					}
				}
				a & 4 && e.stateNode != null && (t = e.memoizedProps, Rl(e, t, r === null ? t : r.memoizedProps)), a & 1024 && (fu = !0);
				break;
			case 6:
				if (Pu(t, e, n), Lu(e), a & 4) {
					if (e.stateNode === null) throw Error(i(162));
					t = e.memoizedProps, n = e.stateNode;
					try {
						n.nodeValue = t, en = !0;
					} catch (t) {
						Cf(e, e.return, t);
					}
				}
				break;
			case 3:
				if (en = !1, $m = null, o = Fu, Fu = jm(t.containerInfo), Pu(t, e, n), Fu = o, Lu(e), a & 4 && r !== null && r.memoizedState.isDehydrated) try {
					qh(t.containerInfo);
				} catch (t) {
					Cf(e, e.return, t);
				}
				fu && (fu = !1, Ru(e)), en = !1;
				break;
			case 4:
				a = du, du = lu, r = tn(), o = Fu, Fu = jm(e.stateNode.containerInfo), Pu(t, e, n), Lu(e), Fu = o, en && gu && (_u = !0), en = r, du = a;
				break;
			case 12:
				Pu(t, e, n), Lu(e);
				break;
			case 31:
				Pu(t, e, n), Lu(e), a & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Nu(e, t)));
				break;
			case 13:
				Pu(t, e, n), Lu(e), e.child.flags & 8192 && e.memoizedState !== null != (r !== null && r.memoizedState !== null) && (Cd = Je()), a & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Nu(e, t)));
				break;
			case 22:
				o = e.memoizedState !== null, s = r !== null && r.memoizedState !== null;
				var c = lu, l = uu, u = du;
				lu = c || o, du = u || o, uu = l || s, Pu(t, e, n), uu = l, du = u, lu = c, Lu(e), a & 8192 && (t = e.stateNode, t._visibility = o ? t._visibility & -2 : t._visibility | 1, !o || r === null || s || lu || uu || (t = s || uu, n = lu, r = uu, lu = o || lu, uu = t, Hu(e, 2), lu = n, uu = r), !o && du || Su(e, o)), a & 4 && (t = e.updateQueue, t !== null && (n = t.retryQueue, n !== null && (t.retryQueue = null, Nu(e, n))));
				break;
			case 19:
				Pu(t, e, n), Lu(e), a & 4 && (t = e.updateQueue, t !== null && (e.updateQueue = null, Nu(e, t)));
				break;
			case 30:
				a & 512 && (uu || r === null || jl(r, r.return)), a = tn(), o = gu, s = (n & 335544064) === n, c = e.memoizedProps, gu = s && wi(c.default, c.update) !== "none", Pu(t, e, n), Lu(e), s && r !== null && en && (e.flags |= 4), gu = o, en = a;
				break;
			case 21: break;
			case 7: a & 512 && (uu || r === null || jl(r, r.return)), r && r.stateNode !== null && (r.stateNode._fragmentFiber = e);
			default: Pu(t, e, n), Lu(e);
		}
	}
	function Lu(e) {
		var t = e.flags;
		if (t & 2) {
			try {
				for (var n, r = e.return; r !== null;) {
					if (zl(r)) {
						n = r;
						break;
					}
					r = r.return;
				}
				r = null;
				for (var a = e.return; a !== null;) {
					if (Il(a)) {
						var o = a.stateNode;
						r === null ? r = [o] : r.push(o);
					}
					if (Fl(a)) break;
					a = a.return;
				}
				var s = r;
				if (n == null) throw Error(i(160));
				switch (n.tag) {
					case 27:
						var c = n.stateNode;
						Hl(e, Bl(e), c, s);
						break;
					case 5:
						var l = n.stateNode;
						n.flags & 32 && (vn(l, ""), n.flags &= -33), Hl(e, Bl(e), l, s);
						break;
					case 3:
					case 4:
						var u = n.stateNode.containerInfo;
						Vl(e, Bl(e), u, s);
						break;
					default: throw Error(i(161));
				}
			} catch (t) {
				Cf(e, e.return, t);
			}
			e.flags &= -3;
		}
		t & 4096 && (e.flags &= -4097);
	}
	function Ru(e) {
		if (e.subtreeFlags & 1024) for (e = e.child; e !== null;) {
			var t = e;
			Ru(t), t.tag === 5 && t.flags & 1024 && (t = t.stateNode, Th = !0, t.reset(), Th = !1), e = e.sibling;
		}
	}
	function zu(e, t) {
		if (t.subtreeFlags & 9270) for (t = t.child; t !== null;) Bu(t, e), t = t.sibling;
		else cu(t, !1);
	}
	function Bu(e, t) {
		var n = e.alternate;
		if (n === null) eu(e, !1);
		else switch (e.tag) {
			case 3:
				if (vu = hu = !1, Jl(), zu(t, e), !hu && !_u) {
					if (e = ql, e !== null) for (var r = 0; r < e.length; r += 3) {
						n = e[r];
						var i = e[r + 1];
						Lp(n, e[r + 2]), n = n.ownerDocument.documentElement, n !== null && n.animate({
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
					})), vu = !0;
				}
				ql = null;
				break;
			case 5:
				zu(t, e);
				break;
			case 4:
				r = hu, hu = !1, zu(t, e), hu && (_u = !0), hu = r;
				break;
			case 22:
				e.memoizedState === null && (n.memoizedState === null ? zu(t, e) : eu(e, !1));
				break;
			case 30:
				r = hu, i = Jl(), hu = !1, zu(t, e), hu && (e.flags |= 4);
				var a = e.memoizedProps, o = e.stateNode;
				t = Si(a, o), o = Si(n.memoizedProps, o);
				var s = wi(a.default, a.update);
				s === "none" ? t = !1 : (a = n.memoizedState, n.memoizedState = null, n = e.child, Yl = 0, t = su(e, n, t, o, s, a, !0), Yl !== (a === null ? 0 : a.length) && (e.flags |= 32)), e.flags & 4 && t ? (Hd(e, e.memoizedProps.onUpdate), ql = i) : i !== null && (i.push.apply(i, ql), ql = i), hu = e.flags & 32 ? !0 : r;
				break;
			default: zu(t, e);
		}
	}
	function Vu(e, t) {
		if (t.subtreeFlags & 8772) for (t = t.child; t !== null;) xu(e, t.alternate, t), t = t.sibling;
	}
	function Hu(e, t) {
		for (e = e.child; e !== null;) {
			var n = e, r = t;
			switch (n.tag) {
				case 0:
				case 11:
				case 14:
				case 15:
					Dl(4, n, n.return), Hu(n, r);
					break;
				case 1:
					jl(n, n.return);
					var i = n.stateNode;
					typeof i.componentWillUnmount == "function" && kl(n, n.return, i), Hu(n, r);
					break;
				case 27: r & 2 && Dm(n.stateNode, n.type, n.memoizedProps);
				case 5:
					jl(n, n.return), n.tag !== 5 && n.tag !== 27 || Pl(n), Hu(n, r);
					break;
				case 6:
					Pl(n);
					break;
				case 26:
					jl(n, n.return), i = n.stateNode, n.memoizedState !== null || i === null || uu || i.parentNode.removeChild(i), Hu(n, r);
					break;
				case 22:
					n.memoizedState === null && Hu(n, r);
					break;
				case 30:
					jl(n, n.return), Hu(n, r);
					break;
				case 7: jl(n, n.return);
				default: Hu(n, r);
			}
			e = e.sibling;
		}
	}
	function Uu(e, t, n) {
		for (n = t.subtreeFlags & 8772 ? n : n & -2, t = t.child; t !== null;) {
			var r = t.alternate, i = e, a = t, o = a.flags, s = !!(n & 1);
			switch (a.tag) {
				case 0:
				case 11:
				case 15:
					Uu(i, a, n), El(4, a);
					break;
				case 1:
					if (Uu(i, a, n), r = a, i = r.stateNode, typeof i.componentDidMount == "function") try {
						i.componentDidMount();
					} catch (e) {
						Cf(r, r.return, e);
					}
					if (r = a, i = r.updateQueue, i !== null) {
						var c = r.stateNode;
						try {
							var l = i.shared.hiddenCallbacks;
							if (l !== null) for (i.shared.hiddenCallbacks = null, i = 0; i < l.length; i++) Eo(l[i], c);
						} catch (e) {
							Cf(r, r.return, e);
						}
					}
					s && o & 64 && Ol(a), Al(a, a.return);
					break;
				case 27: n & 2 && Ul(a);
				case 5:
					a.tag !== 5 && a.tag !== 27 || Nl(a), Uu(i, a, n), s && r === null && o & 4 && Ll(a), Al(a, a.return);
					break;
				case 6:
					Nl(a);
					break;
				case 26:
					c = a.stateNode, a.memoizedState !== null || c === null || lu || th(jm(c.ownerDocument), a.type, c), Uu(i, a, n), s && r === null && o & 4 && Ll(a), Al(a, a.return);
					break;
				case 12:
					Uu(i, a, n);
					break;
				case 31:
					Uu(i, a, n), s && o & 4 && Au(i, a);
					break;
				case 13:
					Uu(i, a, n), s && o & 4 && ju(i, a);
					break;
				case 22:
					a.memoizedState === null && Uu(i, a, n), Al(a, a.return);
					break;
				case 30:
					Uu(i, a, n), Al(a, a.return);
					break;
				case 7: Al(a, a.return);
				default: Uu(i, a, n);
			}
			t = t.sibling;
		}
	}
	function Wu(e, t) {
		var n = null;
		e !== null && e.memoizedState !== null && e.memoizedState.cachePool !== null && (n = e.memoizedState.cachePool.pool), e = null, t.memoizedState !== null && t.memoizedState.cachePool !== null && (e = t.memoizedState.cachePool.pool), e !== n && (e != null && e.refCount++, n != null && Fa(n));
	}
	function Gu(e, t) {
		e = null, t.alternate !== null && (e = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== e && (t.refCount++, e != null && Fa(e));
	}
	function Ku(e, t, n, r) {
		var i = (n & 335544064) === n;
		if (t.subtreeFlags & (i ? 10262 : 10256)) for (t = t.child; t !== null;) qu(e, t, n, r), t = t.sibling;
		else i && ou(t);
	}
	function qu(e, t, n, r) {
		var i = (n & 335544064) === n;
		i && t.alternate === null && t.return !== null && t.return.alternate !== null && au(t);
		var a = t.flags;
		switch (t.tag) {
			case 0:
			case 11:
			case 15:
				Ku(e, t, n, r), a & 2048 && El(9, t);
				break;
			case 1:
				Ku(e, t, n, r);
				break;
			case 3:
				Ku(e, t, n, r), i && vu && (e = e.containerInfo, e = e.nodeType === 9 ? e.body : e.nodeName === "HTML" ? e.ownerDocument.body : e, e.style.viewTransitionName === "root" && (e.style.viewTransitionName = ""), e = e.ownerDocument.documentElement, e !== null && e.style.viewTransitionName === "none" && (e.style.viewTransitionName = "")), a & 2048 && (a = null, t.alternate !== null && (a = t.alternate.memoizedState.cache), t = t.memoizedState.cache, t !== a && (t.refCount++, a != null && Fa(a)));
				break;
			case 12:
				if (a & 2048) {
					Ku(e, t, n, r), a = t.stateNode;
					try {
						var o = t.memoizedProps, s = o.id, c = o.onPostCommit;
						typeof c == "function" && c(s, t.alternate === null ? "mount" : "update", a.passiveEffectDuration, -0);
					} catch (e) {
						Cf(t, t.return, e);
					}
				} else Ku(e, t, n, r);
				break;
			case 31:
				Ku(e, t, n, r);
				break;
			case 13:
				Ku(e, t, n, r);
				break;
			case 23: break;
			case 22:
				o = t.stateNode, s = t.alternate, t.memoizedState === null ? (i && s !== null && s.memoizedState !== null && au(t), o._visibility & 2 ? Ku(e, t, n, r) : (o._visibility |= 2, Ju(e, t, n, r, !!(t.subtreeFlags & 10256) || !1))) : (i && s !== null && s.memoizedState === null && au(s), o._visibility & 2 ? Ku(e, t, n, r) : Yu(e, t)), a & 2048 && Wu(s, t);
				break;
			case 24:
				Ku(e, t, n, r), a & 2048 && Gu(t.alternate, t);
				break;
			case 30:
				i && (a = t.alternate, a !== null && (Ql(a.child, !0), Ql(t.child, !0))), Ku(e, t, n, r);
				break;
			default: Ku(e, t, n, r);
		}
	}
	function Ju(e, t, n, r, i) {
		for (i &&= !!(t.subtreeFlags & 10256) || !1, t = t.child; t !== null;) {
			var a = e, o = t, s = n, c = r, l = o.flags;
			switch (o.tag) {
				case 0:
				case 11:
				case 15:
					Ju(a, o, s, c, i), El(8, o);
					break;
				case 23: break;
				case 22:
					var u = o.stateNode;
					o.memoizedState === null ? (u._visibility |= 2, Ju(a, o, s, c, i)) : u._visibility & 2 ? Ju(a, o, s, c, i) : Yu(a, o), i && l & 2048 && Wu(o.alternate, o);
					break;
				case 24:
					Ju(a, o, s, c, i), i && l & 2048 && Gu(o.alternate, o);
					break;
				default: Ju(a, o, s, c, i);
			}
			t = t.sibling;
		}
	}
	function Yu(e, t) {
		if (t.subtreeFlags & 10256) for (t = t.child; t !== null;) {
			var n = e, r = t, i = r.flags;
			switch (r.tag) {
				case 22:
					Yu(n, r), i & 2048 && Wu(r.alternate, r);
					break;
				case 24:
					Yu(n, r), i & 2048 && Gu(r.alternate, r);
					break;
				default: Yu(n, r);
			}
			t = t.sibling;
		}
	}
	var Xu = 8192;
	function Zu(e, t, n) {
		if (e.subtreeFlags & Xu) for (e = e.child; e !== null;) Qu(e, t, n), e = e.sibling;
	}
	function Qu(e, t, n) {
		switch (e.tag) {
			case 26:
				Zu(e, t, n), e.flags & Xu && (e.memoizedState === null ? (e = e.stateNode, (t & 335544128) === t && oh(n, e)) : sh(n, Fu, e.memoizedState, e.memoizedProps));
				break;
			case 5:
				Zu(e, t, n), e.flags & Xu && (e = e.stateNode, (t & 335544128) === t && oh(n, e));
				break;
			case 3:
			case 4:
				var r = Fu;
				Fu = jm(e.stateNode.containerInfo), Zu(e, t, n), Fu = r;
				break;
			case 22:
				e.memoizedState === null && (r = e.alternate, r !== null && r.memoizedState !== null ? (r = Xu, Xu = 16777216, Zu(e, t, n), Xu = r) : Zu(e, t, n));
				break;
			case 30:
				if ((e.flags & Xu) !== 0 && (r = e.memoizedProps.name, r != null && r !== "auto")) {
					var i = e.stateNode;
					i.paired = null, Gl === null && (Gl = /* @__PURE__ */ new Map()), Gl.set(r, i);
				}
				Zu(e, t, n);
				break;
			default: Zu(e, t, n);
		}
	}
	function $u(e) {
		var t = e.alternate;
		if (t !== null && (e = t.child, e !== null)) {
			t.child = null;
			do
				t = e.sibling, e.sibling = null, e = t;
			while (e !== null);
		}
	}
	function ed(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				mu = r, rd(r, e);
			}
			$u(e);
		}
		if (e.subtreeFlags & 10256) for (e = e.child; e !== null;) td(e), e = e.sibling;
	}
	function td(e) {
		switch (e.tag) {
			case 0:
			case 11:
			case 15:
				ed(e), e.flags & 2048 && Dl(9, e, e.return);
				break;
			case 3:
				ed(e);
				break;
			case 12:
				ed(e);
				break;
			case 22:
				var t = e.stateNode;
				e.memoizedState !== null && t._visibility & 2 && (e.return === null || e.return.tag !== 13) ? (t._visibility &= -3, nd(e)) : ed(e);
				break;
			default: ed(e);
		}
	}
	function nd(e) {
		var t = e.deletions;
		if (e.flags & 16) {
			if (t !== null) for (var n = 0; n < t.length; n++) {
				var r = t[n];
				mu = r, rd(r, e);
			}
			$u(e);
		}
		for (e = e.child; e !== null;) {
			switch (t = e, t.tag) {
				case 0:
				case 11:
				case 15:
					Dl(8, t, t.return), nd(t);
					break;
				case 22:
					n = t.stateNode, n._visibility & 2 && (n._visibility &= -3, nd(t));
					break;
				default: nd(t);
			}
			e = e.sibling;
		}
	}
	function rd(e, t) {
		for (; mu !== null;) {
			var n = mu;
			switch (n.tag) {
				case 0:
				case 11:
				case 15:
					Dl(8, n, t);
					break;
				case 23:
				case 22:
					if (n.memoizedState !== null && n.memoizedState.cachePool !== null) {
						var r = n.memoizedState.cachePool.pool;
						r != null && r.refCount++;
					}
					break;
				case 24: Fa(n.memoizedState.cache);
			}
			if (r = n.child, r !== null) r.return = n, mu = r;
			else a: for (n = e; mu !== null;) {
				r = mu;
				var i = r.sibling, a = r.return;
				if (Tu(r), r === n) {
					mu = null;
					break a;
				}
				if (i !== null) {
					i.return = a, mu = i;
					break a;
				}
				mu = a;
			}
		}
	}
	var id = {
		getCacheForType: function(e) {
			var t = Da(Na), n = t.data.get(e);
			return n === void 0 && (n = e(), t.data.set(e, n)), n;
		},
		cacheSignal: function() {
			return Da(Na).controller.signal;
		}
	}, ad = typeof WeakMap == "function" ? WeakMap : Map, od = 0, sd = null, B = null, V = 0, cd = 0, ld = null, ud = !1, dd = !1, fd = !1, pd = 0, md = 0, hd = 0, gd = 0, _d = 0, vd = 0, yd = 0, bd = null, xd = null, Sd = !1, Cd = 0, wd = 0, Td = Infinity, Ed = null, Dd = null, Od = 0, kd = null, Ad = null, jd = 0, Md = 0, Nd = null, Pd = null, Fd = null, Id = null, Ld = null, Rd = 0, zd = null;
	function Bd() {
		return od & 2 && V !== 0 ? V & -V : O.T === null ? Dt() : Wf();
	}
	function Vd() {
		if (vd === 0) {
			if (!(V & 536870912) || R) {
				var e = dt;
				dt <<= 1, !(dt & 3932160) && (dt = 262144), vd = e;
			} else vd = 536870912;
		}
		return e = No.current, e !== null && (e.flags |= 32), vd;
	}
	function Hd(e, t) {
		if (t != null) {
			var n = e.stateNode, r = n.ref;
			r === null && (r = n.ref = Gp(Si(e.memoizedProps, n))), Id === null && (Id = []), Id.push(t.bind(null, r));
		}
	}
	function Ud(e, t, n) {
		(e === sd && (cd === 2 || cd === 9) || e.cancelPendingCommit !== null) && (Xd(e, 0), qd(e, V, vd, !1)), bt(e, n), (!(od & 2) || e !== sd) && (e === sd && (!(od & 2) && (gd |= n), md === 4 && qd(e, V, vd, !1)), If(e));
	}
	function Wd(e, t, n) {
		if (od & 6) throw Error(i(327));
		var r = !n && !(t & 127) && (t & e.expiredLanes) === 0 || ht(e, t), a = r ? af(e, t) : nf(e, t, !0), o = r;
		do {
			if (a === 0) {
				dd && !r && qd(e, t, 0, !1);
				break;
			}
			if (n = e.current.alternate, o && !Kd(n)) {
				a = nf(e, t, !1), o = !1;
				continue;
			}
			if (a === 2) {
				if (o = t, e.errorRecoveryDisabledLanes & o) var s = 0;
				else s = e.pendingLanes & -536870913, s = s === 0 ? s & 536870912 ? 536870912 : 0 : s;
				if (s !== 0) {
					t = s;
					a: {
						var c = e;
						a = bd;
						var l = c.current.memoizedState.isDehydrated;
						if (l && (Xd(c, s).flags |= 256), s = nf(c, s, !1), s !== 2 && s !== 6) {
							if (fd && !l) {
								c.errorRecoveryDisabledLanes |= o, gd |= o, a = 4;
								break a;
							}
							o = xd, xd = a, o !== null && (xd === null ? xd = o : xd.push.apply(xd, o));
						}
						a = s;
					}
					if (o = !1, a !== 2) continue;
				}
			}
			if (a === 1) {
				Xd(e, 0), qd(e, t, 0, !0);
				break;
			}
			a: {
				switch (r = e, o = a, o) {
					case 0:
					case 1: throw Error(i(345));
					case 4: if ((t & 4194048) !== t && (t & 62914560) !== t) break;
					case 6:
						qd(r, t, vd, !ud);
						break a;
					case 2:
						xd = null;
						break;
					case 3:
					case 5: break;
					default: throw Error(i(329));
				}
				if ((t & 62914560) === t && (a = Cd + 300 - Je(), 10 < a)) {
					if (qd(r, t, vd, !ud), mt(r, 0, !0) !== 0) break a;
					jd = t, r.timeoutHandle = Dp(Gd.bind(null, r, n, xd, Ed, Sd, t, vd, gd, yd, ud, o, "Throttled", -0, 0), a);
					break a;
				}
				Gd(r, n, xd, Ed, Sd, t, vd, gd, yd, ud, o, null, -0, 0);
			}
			break;
		} while (1);
		If(e);
	}
	function Gd(e, t, n, r, i, a, o, s, c, l, u, d, f, p) {
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
			unsuspend: En
		}, Gl = null, Qu(t, a, d), h && (m = d, h = e.containerInfo, h = (h.nodeType === 9 ? h : h.ownerDocument).__reactViewTransition, h != null && (m.count++, m.waitingForViewTransition = !0, m = dh.bind(m), h.finished.then(m, m))), m = (a & 62914560) === a ? Cd - Je() : (a & 4194048) === a ? wd - Je() : 0, m = lh(d, m), m !== null)) {
			jd = a, e.cancelPendingCommit = m(ff.bind(null, e, t, a, n, r, i, o, s, c, l, u, d, null, f, p)), qd(e, a, o, !l);
			return;
		}
		ff(e, t, a, n, r, i, o, s, c, l, u, d);
	}
	function Kd(e) {
		for (var t = e;;) {
			var n = t.tag;
			if ((n === 0 || n === 11 || n === 15) && t.flags & 16384 && (n = t.updateQueue, n !== null && (n = n.stores, n !== null))) for (var r = 0; r < n.length; r++) {
				var i = n[r], a = i.getSnapshot;
				i = i.value;
				try {
					if (!Kr(a(), i)) return !1;
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
	function qd(e, t, n, r) {
		t = gt(e, t), t &= ~_d, t &= ~gd, e.suspendedLanes |= t, e.pingedLanes &= ~t, r && (e.warmLanes |= t), r = e.expirationTimes;
		for (var i = t; 0 < i;) {
			var a = 31 - ot(i), o = 1 << a;
			r[a] = -1, i &= ~o;
		}
		n !== 0 && St(e, n, t);
	}
	function Jd() {
		return od & 6 ? !0 : (Lf(0, !1), !1);
	}
	function Yd() {
		if (B !== null) {
			if (cd === 0) var e = B.return;
			else e = B, ya = va = null, cs(e), so = null, co = 0, e = B;
			for (; e !== null;) Tl(e.alternate, e), e = e.return;
			B = null;
		}
	}
	function Xd(e, t) {
		var n = e.timeoutHandle;
		return n !== -1 && (e.timeoutHandle = -1, Op(n)), n = e.cancelPendingCommit, n !== null && (e.cancelPendingCommit = null, n()), jd = 0, Yd(), sd = e, B = n = zi(e.current, null), V = t, cd = 0, ld = null, ud = !1, dd = ht(e, t), fd = !1, yd = vd = _d = gd = hd = md = 0, xd = bd = null, Sd = !1, pd = gt(e, t), ki(), n;
	}
	function Zd(e, t) {
		z = null, O.H = vc, t === Za || t === $a ? (t = ao(), cd = 3) : t === Qa ? (t = ao(), cd = 4) : cd = t === Ic ? 8 : typeof t == "object" && t && typeof t.then == "function" ? 6 : 1, ld = t, B === null && (md = 1, Ac(e, F(t, e.current)));
	}
	function Qd() {
		var e = No.current;
		return e === null ? !0 : (V & 4194048) === V ? Po === null : (V & 62914560) === V || V & 536870912 ? e === Po : !1;
	}
	function $d() {
		var e = O.H;
		return O.H = vc, e === null ? vc : e;
	}
	function ef() {
		var e = O.A;
		return O.A = id, e;
	}
	function tf() {
		md = 4, ud || (V & 4194048) !== V && No.current !== null || (dd = !0), !(hd & 134217727) && !(gd & 134217727) || sd === null || qd(sd, V, vd, !1);
	}
	function nf(e, t, n) {
		var r = od;
		od |= 2;
		var i = $d(), a = ef();
		(sd !== e || V !== t) && (Ed = null, Xd(e, t)), t = !1;
		var o = md;
		a: do
			try {
				if (cd !== 0 && B !== null) {
					var s = B, c = ld;
					switch (cd) {
						case 8:
							Yd(), o = 6;
							break a;
						case 3:
						case 2:
						case 9:
						case 6:
							No.current === null && (t = !0);
							var l = cd;
							if (cd = 0, ld = null, lf(e, s, c, l), n && dd) {
								o = 0;
								break a;
							}
							break;
						default: l = cd, cd = 0, ld = null, lf(e, s, c, l);
					}
				}
				rf(), o = md;
				break;
			} catch (t) {
				Zd(e, t);
			}
		while (1);
		return t && e.shellSuspendCounter++, ya = va = null, od = r, O.H = i, O.A = a, B === null && (sd = null, V = 0, ki()), o;
	}
	function rf() {
		for (; B !== null;) sf(B);
	}
	function af(e, t) {
		var n = od;
		od |= 2;
		var r = $d(), a = ef();
		sd !== e || V !== t ? (Ed = null, Td = Je() + 500, Xd(e, t)) : dd = ht(e, t);
		a: do
			try {
				if (cd !== 0 && B !== null) {
					t = B;
					var o = ld;
					b: switch (cd) {
						case 1:
							cd = 0, ld = null, lf(e, t, o, 1);
							break;
						case 2:
						case 9:
							if (to(o)) {
								cd = 0, ld = null, cf(t);
								break;
							}
							t = function() {
								cd !== 2 && cd !== 9 || sd !== e || (cd = 7), If(e);
							}, o.then(t, t);
							break a;
						case 3:
							cd = 7;
							break a;
						case 4:
							cd = 5;
							break a;
						case 7:
							to(o) ? (cd = 0, ld = null, cf(t)) : (cd = 0, ld = null, lf(e, t, o, 7));
							break;
						case 5:
							var s = null;
							switch (B.tag) {
								case 26: s = B.memoizedState;
								case 5:
								case 27:
									var c = B;
									if (s ? ih(s) : c.stateNode.complete) {
										cd = 0, ld = null;
										var l = c.sibling;
										if (l !== null) B = l;
										else {
											var u = c.return;
											u === null ? B = null : (B = u, uf(u));
										}
										break b;
									}
							}
							cd = 0, ld = null, lf(e, t, o, 5);
							break;
						case 6:
							cd = 0, ld = null, lf(e, t, o, 6);
							break;
						case 8:
							Yd(), md = 6;
							break a;
						default: throw Error(i(462));
					}
				}
				of();
				break;
			} catch (t) {
				Zd(e, t);
			}
		while (1);
		return ya = va = null, O.H = r, O.A = a, od = n, B === null ? (sd = null, V = 0, ki(), md) : 0;
	}
	function of() {
		for (; B !== null && !Ke();) sf(B);
	}
	function sf(e) {
		var t = gl(e.alternate, e, pd);
		e.memoizedProps = e.pendingProps, t === null ? uf(e) : B = t;
	}
	function cf(e) {
		var t = e, n = t.alternate;
		switch (t.tag) {
			case 15:
			case 0:
				t = Xc(n, t, t.pendingProps, t.type, void 0, V);
				break;
			case 11:
				t = Xc(n, t, t.pendingProps, t.type.render, t.ref, V);
				break;
			case 5:
				cs(t);
				var r = t;
				r === aa && (R ? (fa(r), r.tag === 5 && r.stateNode != null && (oa = r.stateNode)) : (fa(r), R = !0));
			default: Tl(n, t), t = B = Bi(t, pd), t = gl(n, t, pd);
		}
		e.memoizedProps = e.pendingProps, t === null ? uf(e) : B = t;
	}
	function lf(e, t, n, r) {
		ya = va = null, cs(t), so = null, co = 0;
		var i = t.return;
		try {
			if (Fc(e, i, t, n, V)) {
				md = 1, Ac(e, F(n, e.current)), B = null;
				return;
			}
		} catch (t) {
			if (i !== null) throw B = i, t;
			md = 1, Ac(e, F(n, e.current)), B = null;
			return;
		}
		t.flags & 32768 ? (R || r === 1 ? e = !0 : dd || V & 536870912 ? e = !1 : (ud = e = !0, (r === 2 || r === 9 || r === 3 || r === 6) && (r = No.current, r !== null && r.tag === 13 && (r.flags |= 16384))), df(t, e)) : uf(t);
	}
	function uf(e) {
		var t = e;
		do {
			if (t.flags & 32768) {
				df(t, ud);
				return;
			}
			e = t.return;
			var n = Cl(t.alternate, t, pd);
			if (n !== null) {
				B = n;
				return;
			}
			if (t = t.sibling, t !== null) {
				B = t;
				return;
			}
			B = t = e;
		} while (t !== null);
		md === 0 && (md = 5);
	}
	function df(e, t) {
		do {
			var n = wl(e.alternate, e);
			if (n !== null) {
				n.flags &= 32767, B = n;
				return;
			}
			if (n = e.return, n !== null && (n.flags |= 32768, n.subtreeFlags = 0, n.deletions = null), !t && (e = e.sibling, e !== null)) {
				B = e;
				return;
			}
			B = e = n;
		} while (e !== null);
		md = 6, B = null;
	}
	function ff(e, t, n, r, a, o, s, c, l, u, d, f) {
		e.cancelPendingCommit = null;
		do
			bf();
		while (Od !== 0);
		if (od & 6) throw Error(i(327));
		if (t !== null) {
			if (t === e.current) throw Error(i(177));
			e === sd && (B = sd = null, V = 0), Ad = t, kd = e, jd = n, Nd = a, Pd = r, pf(e, t, n, s, c, l, f);
		}
	}
	function pf(e, t, n, r, i, a, o) {
		var s = t.lanes | t.childLanes;
		if (Md = s, s |= Oi, xt(e, n, s, r, i, a), Id = null, (n & 335544064) === n ? (Ld = Ra(e), r = 10262) : (Ld = null, r = 10256), (t.subtreeFlags & r) !== 0 || (t.flags & r) !== 0 ? (e.callbackNode = null, e.callbackPriority = 0, kf(Qe, function() {
			return xf(), null;
		})) : (e.callbackNode = null, e.callbackPriority = 0), Wl = !1, r = !!(t.flags & 13878), t.subtreeFlags & 13878 || r) {
			r = O.T, O.T = null, i = k.p, k.p = 2, a = od, od |= 4;
			try {
				yu(e, t, n);
			} finally {
				od = a, k.p = i, O.T = r;
			}
		}
		Od = 1, Wl ? Fd = Up(o, e.containerInfo, Ld, gf, _f, hf, vf, xf, mf, null, null) : (gf(), _f(), vf());
	}
	function mf(e) {
		if (Od !== 0) {
			var t = kd.onRecoverableError;
			t(e, { componentStack: null });
		}
	}
	function hf() {
		Od === 3 && (Od = 0, Bu(Ad, kd), Od = 4);
	}
	function gf() {
		if (Od === 1) {
			Od = 0;
			var e = kd, t = Ad, n = jd, r = !!(t.flags & 13878);
			if (t.subtreeFlags & 13878 || r) {
				r = O.T, O.T = null;
				var i = k.p;
				k.p = 2;
				var a = od;
				od |= 4;
				try {
					gu = _u = !1, Iu(t, e, n), n = yp;
					var o = Qr(e.containerInfo), s = n.focusedElem, c = n.selectionRange;
					if (o !== s && s && s.ownerDocument && Zr(s.ownerDocument.documentElement, s)) {
						if (c !== null && $r(s)) {
							var l = c.start, u = c.end;
							if (u === void 0 && (u = l), "selectionStart" in s) s.selectionStart = l, s.selectionEnd = Math.min(u, s.value.length);
							else {
								var d = s.ownerDocument || document, f = d && d.defaultView || window;
								if (f.getSelection) {
									var p = f.getSelection(), m = s.textContent.length, h = Math.min(c.start, m), g = c.end === void 0 ? h : Math.min(c.end, m);
									!p.extend && h > g && (o = g, g = h, h = o);
									var _ = Xr(s, h), v = Xr(s, g);
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
					Th = !!vp, yp = vp = null;
				} finally {
					od = a, k.p = i, O.T = r;
				}
			}
			e.current = t, Od = 2;
		}
	}
	function _f() {
		if (Od === 2) {
			Od = 0;
			var e = kd, t = Ad, n = !!(t.flags & 8772);
			if (t.subtreeFlags & 8772 || n) {
				n = O.T, O.T = null;
				var r = k.p;
				k.p = 2;
				var i = od;
				od |= 4;
				try {
					xu(e, t.alternate, t);
				} finally {
					od = i, k.p = r, O.T = n;
				}
			}
			Od = 3;
		}
	}
	function vf() {
		if (Od === 4 || Od === 3) {
			Od = 0;
			var e = Fd;
			Fd = null, qe();
			var t = kd, n = Ad, r = jd, i = Pd, a = (r & 335544064) === r ? 10262 : 10256;
			if ((n.subtreeFlags & a) !== 0 || (n.flags & a) !== 0 ? Od = 5 : (Od = 0, Ad = kd = null, yf(t, t.pendingLanes)), a = t.pendingLanes, a === 0 && (Dd = null), Et(r), n = n.stateNode, it && typeof it.onCommitFiberRoot == "function") try {
				it.onCommitFiberRoot(rt, n, void 0, (n.current.flags & 128) == 128);
			} catch {}
			if (i !== null) {
				n = O.T, a = k.p, k.p = 2, O.T = null;
				try {
					for (var o = t.onRecoverableError, s = 0; s < i.length; s++) {
						var c = i[s];
						o(c.value, { componentStack: c.stack });
					}
				} finally {
					O.T = n, k.p = a;
				}
			}
			if (i = Id, o = Ld, Ld = null, i !== null && (Id = null, o === null && (o = []), e !== null)) for (c = 0; c < i.length; c++) n = (0, i[c])(o), n !== void 0 && e.finished.finally(n);
			jd & 3 && bf(), If(t), a = t.pendingLanes, r & 261930 && a & 42 ? t === zd ? Rd++ : (Rd = 0, zd = t) : (Rd = 0, zd = null), Lf(0, !1);
		}
	}
	function yf(e, t) {
		(e.pooledCacheLanes &= t) === 0 && (t = e.pooledCache, t != null && (e.pooledCache = null, Fa(t)));
	}
	function bf() {
		return Fd !== null && (Fd.skipTransition(), Fd = null), gf(), _f(), vf(), xf();
	}
	function xf() {
		if (Od !== 5) return !1;
		var e = kd, t = Md;
		Md = 0;
		var n = Et(jd), r = O.T, a = k.p;
		try {
			k.p = 32 > n ? 32 : n, O.T = null, n = Nd, Nd = null;
			var o = kd, s = jd;
			if (Od = 0, Ad = kd = null, jd = 0, od & 6) throw Error(i(331));
			var c = od;
			if (od |= 4, td(o.current), qu(o, o.current, s, n), od = c, Lf(0, !1), it && typeof it.onPostCommitFiberRoot == "function") try {
				it.onPostCommitFiberRoot(rt, o);
			} catch {}
			return !0;
		} finally {
			k.p = a, O.T = r, yf(e, t);
		}
	}
	function Sf(e, t, n) {
		t = F(n, t), t = Mc(e.stateNode, t, 2), e = bo(e, t, 2), e !== null && (bt(e, 2), If(e));
	}
	function Cf(e, t, n) {
		if (e.tag === 3) Sf(e, e, n);
		else for (; t !== null;) {
			if (t.tag === 3) {
				Sf(t, e, n);
				break;
			}
			if (t.tag === 1) {
				var r = t.stateNode;
				if (typeof t.type.getDerivedStateFromError == "function" || typeof r.componentDidCatch == "function" && (Dd === null || !Dd.has(r))) {
					e = F(n, e), n = Nc(2), r = bo(t, n, 2), r !== null && (Pc(n, r, t, e), bt(r, 2), If(r));
					break;
				}
			}
			t = t.return;
		}
	}
	function wf(e, t, n) {
		var r = e.pingCache;
		if (r === null) {
			r = e.pingCache = new ad();
			var i = /* @__PURE__ */ new Set();
			r.set(t, i);
		} else i = r.get(t), i === void 0 && (i = /* @__PURE__ */ new Set(), r.set(t, i));
		i.has(n) || (fd = !0, i.add(n), e = Tf.bind(null, e, t, n), t.then(e, e));
	}
	function Tf(e, t, n) {
		var r = e.pingCache;
		r !== null && r.delete(t), e.pingedLanes |= e.suspendedLanes & n, e.warmLanes &= ~n, sd === e && (V & n) === n && (md === 4 || md === 3 && (V & 62914560) === V && 300 > Je() - Cd ? od & 2 ? _d |= n : Xd(e, 0) : _d |= n, yd === V && (yd = 0)), If(e);
	}
	function Ef(e, t) {
		t === 0 && (t = vt()), e = Mi(e, t), e !== null && (bt(e, t), If(e));
	}
	function Df(e) {
		var t = e.memoizedState, n = 0;
		t !== null && (n = t.retryLane), Ef(e, n);
	}
	function Of(e, t) {
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
		r !== null && r.delete(t), Ef(e, n);
	}
	function kf(e, t) {
		return We(e, t);
	}
	var Af = null, jf = null, Mf = !1, Nf = !1, Pf = !1, Ff = 0;
	function If(e) {
		e !== jf && e.next === null && (jf === null ? Af = jf = e : jf = jf.next = e), Nf = !0, Mf || (Mf = !0, Uf());
	}
	function Lf(e, t) {
		if (!Pf && Nf) {
			Pf = !0;
			do
				for (var n = !1, r = Af; r !== null;) {
					if (!t) {
						if (e !== 0) {
							var i = r.pendingLanes;
							if (i === 0) var a = 0;
							else {
								var o = r.suspendedLanes, s = r.pingedLanes;
								a = (1 << 31 - ot(42 | e) + 1) - 1, a &= i & ~(o & ~s), a = a & 201326741 ? a & 201326741 | 1 : a ? a | 2 : 0;
							}
							a !== 0 && (n = !0, Hf(r, a));
						} else a = V, a = mt(r, r === sd ? a : 0, r.cancelPendingCommit !== null || r.timeoutHandle !== -1), !(a & 3) || ht(r, a) || (n = !0, Hf(r, a));
					}
					r = r.next;
				}
			while (n);
			Pf = !1;
		}
	}
	function Rf() {
		zf();
	}
	function zf() {
		Nf = Mf = !1;
		var e = 0;
		Ff !== 0 && Ep() && (e = Ff);
		for (var t = Je(), n = null, r = Af; r !== null;) {
			var i = r.next, a = Bf(r, t);
			a === 0 ? (r.next = null, n === null ? Af = i : n.next = i, i === null && (jf = n)) : (n = r, (e !== 0 || a & 3) && (Nf = !0)), r = i;
		}
		Od !== 0 && Od !== 5 || Lf(e, !1), Ff !== 0 && (Ff = 0);
	}
	function Bf(e, t) {
		for (var n = e.suspendedLanes, r = e.pingedLanes, i = e.expirationTimes, a = e.pendingLanes & -62914561; 0 < a;) {
			var o = 31 - ot(a), s = 1 << o, c = i[o];
			c === -1 ? ((s & n) === 0 || (s & r) !== 0) && (i[o] = _t(s, t)) : c <= t && (e.expiredLanes |= s), a &= ~s;
		}
		if (t = sd, n = V, n = mt(e, e === t ? n : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r = e.callbackNode, n === 0 || e === t && (cd === 2 || cd === 9) || e.cancelPendingCommit !== null) return r !== null && r !== null && Ge(r), e.callbackNode = null, e.callbackPriority = 0;
		if (!(n & 3) || ht(e, n)) {
			if (t = n & -n, t === e.callbackPriority) return t;
			switch (r !== null && Ge(r), Et(n)) {
				case 2:
				case 8:
					n = Ze;
					break;
				case 32:
					n = Qe;
					break;
				case 268435456:
					n = et;
					break;
				default: n = Qe;
			}
			return r = Vf.bind(null, e), n = We(n, r), e.callbackPriority = t, e.callbackNode = n, t;
		}
		return r !== null && r !== null && Ge(r), e.callbackPriority = 2, e.callbackNode = null, 2;
	}
	function Vf(e, t) {
		if (Od !== 0 && Od !== 5) return e.callbackNode = null, e.callbackPriority = 0, null;
		var n = e.callbackNode;
		if (bf() && e.callbackNode !== n) return null;
		var r = V;
		return r = mt(e, e === sd ? r : 0, e.cancelPendingCommit !== null || e.timeoutHandle !== -1), r === 0 ? null : (Wd(e, r, t), Bf(e, Je()), e.callbackNode != null && e.callbackNode === n ? Vf.bind(null, e) : null);
	}
	function Hf(e, t) {
		if (bf()) return null;
		Wd(e, t, !0);
	}
	function Uf() {
		jp(function() {
			od & 6 ? We(Xe, Rf) : zf();
		});
	}
	function Wf() {
		if (Ff === 0) {
			var e = Va;
			e === 0 && (e = ut, ut <<= 1, !(ut & 261888) && (ut = 256)), Ff = e;
		}
		return Ff;
	}
	function Gf(e) {
		return e == null || typeof e == "symbol" || typeof e == "boolean" ? null : typeof e == "function" ? e : Tn(e);
	}
	function Kf(e, t, n, r, i) {
		if (t === "submit" && n && n.stateNode === i) {
			var a = Gf((i[jt] || null).action), o = r.submitter;
			o && (t = (t = o[jt] || null) ? Gf(t.formAction) : o.getAttribute("formAction"), t !== null && (a = t, o = null));
			var s = new N("action", "action", null, r, i);
			e.push({
				event: s,
				listeners: [{
					instance: null,
					listener: function() {
						if (r.defaultPrevented) {
							if (Ff !== 0) {
								var e = new FormData(i, o);
								ic(n, {
									pending: !0,
									data: e,
									method: i.method,
									action: a
								}, null, e);
							}
						} else typeof a == "function" && (s.preventDefault(), e = new FormData(i, o), ic(n, {
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
	for (var qf = 0; qf < yi.length; qf++) {
		var Jf = yi[qf];
		bi(Jf.toLowerCase(), "on" + (Jf[0].toUpperCase() + Jf.slice(1)));
	}
	bi(di, "onAnimationEnd"), bi(fi, "onAnimationIteration"), bi(pi, "onAnimationStart"), bi("dblclick", "onDoubleClick"), bi("focusin", "onFocus"), bi("focusout", "onBlur"), bi(mi, "onTransitionRun"), bi(hi, "onTransitionStart"), bi(gi, "onTransitionCancel"), bi(_i, "onTransitionEnd"), Yt("onMouseEnter", ["mouseout", "mouseover"]), Yt("onMouseLeave", ["mouseout", "mouseover"]), Yt("onPointerEnter", ["pointerout", "pointerover"]), Yt("onPointerLeave", ["pointerout", "pointerover"]), Jt("onChange", "change click focusin focusout input keydown keyup selectionchange".split(" ")), Jt("onSelect", "focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")), Jt("onBeforeInput", [
		"compositionend",
		"keypress",
		"textInput",
		"paste"
	]), Jt("onCompositionEnd", "compositionend focusout keydown keypress keyup mousedown".split(" ")), Jt("onCompositionStart", "compositionstart focusout keydown keypress keyup mousedown".split(" ")), Jt("onCompositionUpdate", "compositionupdate focusout keydown keypress keyup mousedown".split(" "));
	var Yf = "abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "), Xf = new Set("beforetoggle cancel close invalid load scroll scrollend toggle".split(" ").concat(Yf));
	function Zf(e, t) {
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
						Ti(e);
					}
					i.currentTarget = null, a = c;
				}
				else for (o = 0; o < r.length; o++) {
					if (s = r[o], c = s.instance, l = s.currentTarget, s = s.listener, c !== a && i.isPropagationStopped()) break a;
					a = s, i.currentTarget = l;
					try {
						a(i);
					} catch (e) {
						Ti(e);
					}
					i.currentTarget = null, a = c;
				}
			}
		}
	}
	function H(e, t) {
		var n = t[Nt];
		n === void 0 && (n = t[Nt] = /* @__PURE__ */ new Set());
		var r = e + "__bubble";
		n.has(r) || (tp(t, e, 2, !1), n.add(r));
	}
	function Qf(e, t, n) {
		var r = 0;
		t && (r |= 4), tp(n, e, r, t);
	}
	var $f = "_reactListening" + Math.random().toString(36).slice(2);
	function ep(e) {
		if (!e[$f]) {
			e[$f] = !0, Kt.forEach(function(t) {
				t !== "selectionchange" && (Xf.has(t) || Qf(t, !1, e), Qf(t, !0, e));
			});
			var t = e.nodeType === 9 ? e : e.ownerDocument;
			t === null || t[$f] || (t[$f] = !0, Qf("selectionchange", !1, t));
		}
	}
	function tp(e, t, n, r) {
		switch (Mh(t)) {
			case 2:
				var i = Eh;
				break;
			case 8:
				i = Dh;
				break;
			default: i = Oh;
		}
		n = i.bind(null, t, n, e), i = void 0, !M || t !== "touchstart" && t !== "touchmove" && t !== "wheel" || (i = !0), r ? i === void 0 ? e.addEventListener(t, n, !0) : e.addEventListener(t, n, {
			capture: !0,
			passive: i
		}) : i === void 0 ? e.addEventListener(t, n, !1) : e.addEventListener(t, n, { passive: i });
	}
	function np(e, t, n, r, i) {
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
					if (s = Bt(c), s === null) return;
					if (l = s.tag, l === 5 || l === 6 || l === 26 || l === 27) {
						r = a = s;
						continue a;
					}
					c = c.parentNode;
				}
			}
			r = r.return;
		}
		Nn(function() {
			var r = a, i = On(n), s = [];
			a: {
				var c = vi.get(e);
				if (c !== void 0) {
					var l = N, u = e;
					switch (e) {
						case "keypress": if (Vn(n) === 0) break a;
						case "keydown":
						case "keyup":
							l = lr;
							break;
						case "focusin":
							u = "focus", l = er;
							break;
						case "focusout":
							u = "blur", l = er;
							break;
						case "beforeblur":
						case "afterblur":
							l = er;
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
							l = Qn;
							break;
						case "drag":
						case "dragend":
						case "dragenter":
						case "dragexit":
						case "dragleave":
						case "dragover":
						case "dragstart":
						case "drop":
							l = $n;
							break;
						case "touchcancel":
						case "touchend":
						case "touchmove":
						case "touchstart":
							l = fr;
							break;
						case di:
						case fi:
						case pi:
							l = tr;
							break;
						case _i:
							l = pr;
							break;
						case "scroll":
						case "scrollend":
							l = qn;
							break;
						case "wheel":
							l = mr;
							break;
						case "copy":
						case "cut":
						case "paste":
							l = nr;
							break;
						case "gotpointercapture":
						case "lostpointercapture":
						case "pointercancel":
						case "pointerdown":
						case "pointermove":
						case "pointerout":
						case "pointerover":
						case "pointerup":
							l = ur;
							break;
						case "submit":
							l = dr;
							break;
						case "toggle":
						case "beforetoggle": l = hr;
					}
					var d = !!(t & 4), f = !d && (e === "scroll" || e === "scrollend"), p = d ? c === null ? null : c + "Capture" : c;
					d = [];
					for (var m = r, h; m !== null;) {
						var g = m;
						if (h = g.stateNode, g = g.tag, g !== 5 && g !== 26 && g !== 27 || h === null || p === null || (g = Pn(m, p), g != null && d.push(rp(m, g, h))), f) break;
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
					if (l = e === "mouseover" || e === "pointerover", c = e === "mouseout" || e === "pointerout", l && n !== Dn && (u = n.relatedTarget || n.fromElement) && (Bt(u) || u[Mt])) break a;
					(c || l) && (u = i.window === i ? i : (l = i.ownerDocument) ? l.defaultView || l.parentWindow : window, c ? (l = n.relatedTarget || n.toElement, c = r, l = l ? Bt(l) : null, l !== null && (f = o(l), d = l.tag, l !== f || d !== 5 && d !== 27 && d !== 6) && (l = null)) : (c = null, l = r), c !== l && (d = Qn, g = "onMouseLeave", p = "onMouseEnter", m = "mouse", (e === "pointerout" || e === "pointerover") && (d = ur, g = "onPointerLeave", p = "onPointerEnter", m = "pointer"), f = c == null ? u : Ht(c), h = l == null ? u : Ht(l), u = new d(g, m + "leave", c, n, i), u.target = f, u.relatedTarget = h, g = null, Bt(i) === r && (d = new d(p, m + "enter", l, n, i), d.target = h, d.relatedTarget = f, g = d), f = g, d = c && l ? ee(c, l, ap) : null, c !== null && op(s, u, c, d, !1), l !== null && f !== null && op(s, f, l, d, !0)));
				}
				a: {
					if (c = r ? Ht(r) : window, l = c.nodeName && c.nodeName.toLowerCase(), l === "select" || l === "input" && c.type === "file") var _ = Pr;
					else if (kr(c)) {
						if (Fr) _ = Wr;
						else {
							_ = Hr;
							var v = Vr;
						}
					} else l = c.nodeName, !l || l.toLowerCase() !== "input" || c.type !== "checkbox" && c.type !== "radio" ? r && Sn(r.elementType) && (_ = Pr) : _ = Ur;
					if (_ &&= _(e, r)) {
						Ar(s, _, n, i);
						break a;
					}
					v && v(e, c, r);
				}
				switch (v = r ? Ht(r) : window, e) {
					case "focusin":
						(kr(v) || v.contentEditable === "true") && (ti = v, ni = r, ri = null);
						break;
					case "focusout":
						ri = ni = ti = null;
						break;
					case "mousedown":
						ii = !0;
						break;
					case "contextmenu":
					case "mouseup":
					case "dragend":
						ii = !1, ai(s, n, i);
						break;
					case "selectionchange": if (ei) break;
					case "keydown":
					case "keyup": ai(s, n, i);
				}
				var y;
				if (_r) b: {
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
				else Tr ? Cr(e, n) && (b = "onCompositionEnd") : e === "keydown" && n.keyCode === 229 && (b = "onCompositionStart");
				b && (br && n.locale !== "ko" && (Tr || b !== "onCompositionStart" ? b === "onCompositionEnd" && Tr && (y = Bn()) : (Ln = i, Rn = "value" in Ln ? Ln.value : Ln.textContent, Tr = !0)), v = ip(r, b), 0 < v.length && (b = new rr(b, e, null, n, i), s.push({
					event: b,
					listeners: v
				}), y ? b.data = y : (y = wr(n), y !== null && (b.data = y)))), (y = yr ? Er(e, n) : Dr(e, n)) && (b = ip(r, "onBeforeInput"), 0 < b.length && (v = new rr("onBeforeInput", "beforeinput", null, n, i), s.push({
					event: v,
					listeners: b
				}), v.data = y)), Kf(s, e, r, n, i);
			}
			Zf(s, t);
		});
	}
	function rp(e, t, n) {
		return {
			instance: e,
			listener: t,
			currentTarget: n
		};
	}
	function ip(e, t) {
		for (var n = t + "Capture", r = []; e !== null;) {
			var i = e, a = i.stateNode;
			if (i = i.tag, i !== 5 && i !== 26 && i !== 27 || a === null || (i = Pn(e, n), i != null && r.unshift(rp(e, i, a)), i = Pn(e, t), i != null && r.push(rp(e, i, a))), e.tag === 3) return r;
			e = e.return;
		}
		return [];
	}
	function ap(e) {
		if (e === null) return null;
		do
			e = e.return;
		while (e && e.tag !== 5 && e.tag !== 27);
		return e || null;
	}
	function op(e, t, n, r, i) {
		for (var a = t._reactName, o = []; n !== null && n !== r;) {
			var s = n, c = s.alternate, l = s.stateNode;
			if (s = s.tag, c !== null && c === r) break;
			s !== 5 && s !== 26 && s !== 27 || l === null || (c = l, i ? (l = Pn(n, a), l != null && o.unshift(rp(n, l, c))) : i || (l = Pn(n, a), l != null && o.push(rp(n, l, c)))), n = n.return;
		}
		o.length !== 0 && e.push({
			event: t,
			listeners: o
		});
	}
	var sp = /\r\n?/g, cp = /\u0000|\uFFFD/g;
	function lp(e) {
		return (typeof e == "string" ? e : "" + e).replace(sp, "\n").replace(cp, "");
	}
	function up(e, t) {
		return t = lp(t), lp(e) === t;
	}
	function dp(e, t, n, r, a, o) {
		switch (n) {
			case "children":
				if (typeof r == "string") t === "body" || t === "textarea" && r === "" || vn(e, r);
				else if (typeof r == "number" || typeof r == "bigint") t !== "body" && vn(e, "" + r);
				else return;
				break;
			case "className":
				rn(e, "class", r);
				break;
			case "tabIndex":
				rn(e, "tabindex", r);
				break;
			case "dir":
			case "role":
			case "viewBox":
			case "width":
			case "height":
				rn(e, n, r);
				break;
			case "style":
				xn(e, r, o);
				return;
			case "data": if (t !== "object") {
				rn(e, "data", r);
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
				r = Tn(r), e.setAttribute(n, r);
				break;
			case "action":
			case "formAction":
				if (typeof r == "function") {
					e.setAttribute(n, "javascript:throw new Error('A React form was unexpectedly submitted. If you called form.submit() manually, consider using form.requestSubmit() instead. If you\\'re trying to use event.stopPropagation() in a submit event handler, consider also calling event.preventDefault().')");
					break;
				}
				if (typeof o == "function" && (n === "formAction" ? (t !== "input" && dp(e, t, "name", a.name, a, null), dp(e, t, "formEncType", a.formEncType, a, null), dp(e, t, "formMethod", a.formMethod, a, null), dp(e, t, "formTarget", a.formTarget, a, null)) : (dp(e, t, "encType", a.encType, a, null), dp(e, t, "method", a.method, a, null), dp(e, t, "target", a.target, a, null))), r == null || typeof r == "symbol" || typeof r == "boolean") {
					e.removeAttribute(n);
					break;
				}
				r = Tn(r), e.setAttribute(n, r);
				break;
			case "onClick":
				r != null && (e.onclick = En);
				return;
			case "onScroll":
				r != null && H("scroll", e);
				return;
			case "onScrollEnd":
				r != null && H("scrollend", e);
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
				n = Tn(r), e.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", n);
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
				H("beforetoggle", e), H("toggle", e), nn(e, "popover", r);
				break;
			case "xlinkActuate":
				an(e, "http://www.w3.org/1999/xlink", "xlink:actuate", r);
				break;
			case "xlinkArcrole":
				an(e, "http://www.w3.org/1999/xlink", "xlink:arcrole", r);
				break;
			case "xlinkRole":
				an(e, "http://www.w3.org/1999/xlink", "xlink:role", r);
				break;
			case "xlinkShow":
				an(e, "http://www.w3.org/1999/xlink", "xlink:show", r);
				break;
			case "xlinkTitle":
				an(e, "http://www.w3.org/1999/xlink", "xlink:title", r);
				break;
			case "xlinkType":
				an(e, "http://www.w3.org/1999/xlink", "xlink:type", r);
				break;
			case "xmlBase":
				an(e, "http://www.w3.org/XML/1998/namespace", "xml:base", r);
				break;
			case "xmlLang":
				an(e, "http://www.w3.org/XML/1998/namespace", "xml:lang", r);
				break;
			case "xmlSpace":
				an(e, "http://www.w3.org/XML/1998/namespace", "xml:space", r);
				break;
			case "is":
				nn(e, "is", r);
				break;
			case "innerText":
			case "textContent": return;
			default: if (!(2 < n.length) || n[0] !== "o" && n[0] !== "O" || n[1] !== "n" && n[1] !== "N") n = Cn.get(n) || n, nn(e, n, r);
			else return;
		}
		en = !0;
	}
	function fp(e, t, n, r, a, o) {
		switch (n) {
			case "style":
				xn(e, r, o);
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
				if (typeof r == "string") vn(e, r);
				else if (typeof r == "number" || typeof r == "bigint") vn(e, "" + r);
				else return;
				break;
			case "onScroll":
				r != null && H("scroll", e);
				return;
			case "onScrollEnd":
				r != null && H("scrollend", e);
				return;
			case "onClick":
				r != null && (e.onclick = En);
				return;
			case "suppressContentEditableWarning":
			case "suppressHydrationWarning":
			case "innerHTML":
			case "ref": return;
			case "innerText":
			case "textContent": return;
			default:
				if (!qt.hasOwnProperty(n)) a: {
					if (n[0] === "o" && n[1] === "n" && (a = n.endsWith("Capture"), o = n.slice(2, a ? n.length - 7 : void 0), t = e[jt] || null, t = t == null ? null : t[n], typeof t == "function" && e.removeEventListener(o, t, a), typeof r == "function")) {
						typeof t != "function" && t !== null && (n in e ? e[n] = null : e.hasAttribute(n) && e.removeAttribute(n)), e.addEventListener(o, r, a);
						break a;
					}
					en = !0, n in e ? e[n] = r : !0 === r ? e.setAttribute(n, "") : nn(e, n, r);
				}
				return;
		}
		en = !0;
	}
	function pp(e, t, n) {
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
				H("error", e), H("load", e);
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
						default: dp(e, t, o, s, n, null);
					}
				}
				a && dp(e, t, "srcSet", n.srcSet, n, null), r && dp(e, t, "src", n.src, n, null);
				return;
			case "input":
				H("invalid", e);
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
						default: dp(e, t, r, d, n, null);
					}
				}
				pn(e, o, c, l, u, s, a, !1);
				return;
			case "select":
				for (a in H("invalid", e), r = s = o = null, n) if (n.hasOwnProperty(a) && (c = n[a], c != null)) switch (a) {
					case "value":
						o = c;
						break;
					case "defaultValue":
						s = c;
						break;
					case "multiple": r = c;
					default: dp(e, t, a, c, n, null);
				}
				t = o, n = s, e.multiple = !!r, t == null ? n != null && hn(e, !!r, n, !0) : hn(e, !!r, t, !1);
				return;
			case "textarea":
				for (s in H("invalid", e), o = a = r = null, n) if (n.hasOwnProperty(s) && (c = n[s], c != null)) switch (s) {
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
					default: dp(e, t, s, c, n, null);
				}
				_n(e, r, a, o);
				return;
			case "option":
				for (l in n) if (n.hasOwnProperty(l) && (r = n[l], r != null)) switch (l) {
					case "selected":
						e.selected = r && typeof r != "function" && typeof r != "symbol";
						break;
					default: dp(e, t, l, r, n, null);
				}
				return;
			case "dialog":
				H("beforetoggle", e), H("toggle", e), H("cancel", e), H("close", e);
				break;
			case "iframe":
			case "object":
				H("load", e);
				break;
			case "video":
			case "audio":
				for (r = 0; r < Yf.length; r++) H(Yf[r], e);
				break;
			case "image":
				H("error", e), H("load", e);
				break;
			case "details":
				H("toggle", e);
				break;
			case "embed":
			case "source":
			case "link": H("error", e), H("load", e);
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
					default: dp(e, t, u, r, n, null);
				}
				return;
			default: if (Sn(t)) {
				for (d in n) n.hasOwnProperty(d) && (r = n[d], r !== void 0 && fp(e, t, d, r, n, void 0));
				return;
			}
		}
		for (c in n) n.hasOwnProperty(c) && (r = n[c], r != null && dp(e, t, c, r, n, null));
	}
	var mp = {};
	function hp(e, t, n, r) {
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
						default: r.hasOwnProperty(m) || dp(e, t, m, null, r, f);
					}
				}
				for (var p in r) {
					var m = r[p];
					if (f = n[p], r.hasOwnProperty(p) && (m != null || f != null)) switch (p) {
						case "type":
							m !== f && (en = !0), o = m;
							break;
						case "name":
							m !== f && (en = !0), a = m;
							break;
						case "checked":
							m !== f && (en = !0), u = m;
							break;
						case "defaultChecked":
							m !== f && (en = !0), d = m;
							break;
						case "value":
							m !== f && (en = !0), s = m;
							break;
						case "defaultValue":
							m !== f && (en = !0), c = m;
							break;
						case "children":
						case "dangerouslySetInnerHTML":
							if (m != null) throw Error(i(137, t));
							break;
						default: m !== f && dp(e, t, p, m, r, f);
					}
				}
				fn(e, s, c, l, u, d, o, a);
				return;
			case "select":
				for (o in m = s = c = p = null, n) if (l = n[o], n.hasOwnProperty(o) && l != null) switch (o) {
					case "value": break;
					case "multiple": m = l;
					default: r.hasOwnProperty(o) || dp(e, t, o, null, r, l);
				}
				for (a in r) if (o = r[a], l = n[a], r.hasOwnProperty(a) && (o != null || l != null)) switch (a) {
					case "value":
						o !== l && (en = !0), p = o;
						break;
					case "defaultValue":
						o !== l && (en = !0), c = o;
						break;
					case "multiple": o !== l && (en = !0), s = o;
					default: o !== l && dp(e, t, a, o, r, l);
				}
				t = c, n = s, r = m, p == null ? !!r != !!n && (t == null ? hn(e, !!n, n ? [] : "", !1) : hn(e, !!n, t, !0)) : hn(e, !!n, p, !1);
				return;
			case "textarea":
				for (c in m = p = null, n) if (a = n[c], n.hasOwnProperty(c) && a != null && !r.hasOwnProperty(c)) switch (c) {
					case "value": break;
					case "children": break;
					default: dp(e, t, c, null, r, a);
				}
				for (s in r) if (a = r[s], o = n[s], r.hasOwnProperty(s) && (a != null || o != null)) switch (s) {
					case "value":
						a !== o && (en = !0), p = a;
						break;
					case "defaultValue":
						a !== o && (en = !0), m = a;
						break;
					case "children": break;
					case "dangerouslySetInnerHTML":
						if (a != null) throw Error(i(91));
						break;
					default: a !== o && dp(e, t, s, a, r, o);
				}
				gn(e, p, m);
				return;
			case "option":
				for (var h in n) if (p = n[h], n.hasOwnProperty(h) && p != null && !r.hasOwnProperty(h)) switch (h) {
					case "selected":
						e.selected = !1;
						break;
					default: dp(e, t, h, null, r, p);
				}
				for (l in r) if (p = r[l], m = n[l], r.hasOwnProperty(l) && p !== m && (p != null || m != null)) switch (l) {
					case "selected":
						p !== m && (en = !0), e.selected = p && typeof p != "function" && typeof p != "symbol";
						break;
					default: dp(e, t, l, p, r, m);
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
				for (var g in n) p = n[g], n.hasOwnProperty(g) && p != null && !r.hasOwnProperty(g) && dp(e, t, g, null, r, p);
				for (u in r) if (p = r[u], m = n[u], r.hasOwnProperty(u) && p !== m && (p != null || m != null)) switch (u) {
					case "children":
					case "dangerouslySetInnerHTML":
						if (p != null) throw Error(i(137, t));
						break;
					default: dp(e, t, u, p, r, m);
				}
				return;
			default: if (Sn(t)) {
				for (var _ in n) p = n[_], n.hasOwnProperty(_) && p !== void 0 && !r.hasOwnProperty(_) && fp(e, t, _, void 0, r, p);
				for (d in r) p = r[d], m = n[d], !r.hasOwnProperty(d) || p === m || p === void 0 && m === void 0 || fp(e, t, d, p, r, m);
				return;
			}
		}
		for (var v in n) p = n[v], n.hasOwnProperty(v) && p != null && !r.hasOwnProperty(v) && dp(e, t, v, null, r, p);
		for (f in r) p = r[f], m = n[f], !r.hasOwnProperty(f) || p === m || p == null && m == null || dp(e, t, f, p, r, m);
	}
	function gp(e) {
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
	function _p() {
		if (typeof performance.getEntriesByType == "function") {
			for (var e = 0, t = 0, n = performance.getEntriesByType("resource"), r = 0; r < n.length; r++) {
				var i = n[r], a = i.transferSize, o = i.initiatorType, s = i.duration;
				if (a && s && gp(o)) {
					for (o = 0, s = i.responseEnd, r += 1; r < n.length; r++) {
						var c = n[r], l = c.startTime;
						if (l > s) break;
						var u = c.transferSize, d = c.initiatorType;
						u && gp(d) && (c = c.responseEnd, o += u * (c < s ? 1 : (s - l) / (c - l)));
					}
					if (--r, t += 8 * (a + o) / (i.duration / 1e3), e++, 10 < e) break;
				}
			}
			if (0 < e) return t / e / 1e6;
		}
		return navigator.connection && (e = navigator.connection.downlink, typeof e == "number") ? e : 5;
	}
	var vp = null, yp = null;
	function bp(e) {
		return e.nodeType === 9 ? e : e.ownerDocument;
	}
	function xp(e) {
		switch (e) {
			case "http://www.w3.org/2000/svg": return 1;
			case "http://www.w3.org/1998/Math/MathML": return 2;
			default: return 0;
		}
	}
	function Sp(e, t) {
		if (e === 0) switch (t) {
			case "svg": return 1;
			case "math": return 2;
			default: return 0;
		}
		return e === 1 && t === "foreignObject" ? 0 : e;
	}
	function Cp(e, t, n, r) {
		return n = bp(n).createElement(e), n[At] = r, n[jt] = t, pp(n, e, t), Wt(n), n;
	}
	function wp(e, t) {
		return e === "textarea" || e === "noscript" || typeof t.children == "string" || typeof t.children == "number" || typeof t.children == "bigint" || typeof t.dangerouslySetInnerHTML == "object" && t.dangerouslySetInnerHTML !== null && t.dangerouslySetInnerHTML.__html != null;
	}
	var Tp = null;
	function Ep() {
		var e = window.event;
		return e && e.type === "popstate" ? e !== Tp && (Tp = e, !0) : (Tp = null, !1);
	}
	var Dp = typeof setTimeout == "function" ? setTimeout : void 0, Op = typeof clearTimeout == "function" ? clearTimeout : void 0, kp = typeof Promise == "function" ? Promise : void 0, Ap = typeof requestAnimationFrame == "function" ? requestAnimationFrame : Dp, jp = typeof queueMicrotask == "function" ? queueMicrotask : kp === void 0 ? Dp : function(e) {
		return kp.resolve(null).then(e).catch(Mp);
	};
	function Mp(e) {
		setTimeout(function() {
			throw e;
		});
	}
	function Np(e) {
		return e === "head";
	}
	function Pp(e, t) {
		var n = t, r = 0;
		do {
			var i = n.nextSibling;
			if (e.removeChild(n), i && i.nodeType === 8) {
				if (n = i.data, n === "/$" || n === "/&") {
					if (r === 0) {
						e.removeChild(i), qh(t);
						return;
					}
					r--;
				} else if (n === "$" || n === "$?" || n === "$~" || n === "$!" || n === "&") r++;
				else if (n === "html") Om(e.ownerDocument.documentElement);
				else if (n === "head") {
					n = e.ownerDocument.head, Om(n);
					for (var a = n.firstChild; a;) {
						var o = a.nextSibling, s = a.nodeName;
						a[Lt] || s === "SCRIPT" || s === "STYLE" || s === "LINK" && a.rel.toLowerCase() === "stylesheet" || n.removeChild(a), a = o;
					}
				} else n === "body" && Om(e.ownerDocument.body);
			}
			n = i;
		} while (n);
		qh(t);
	}
	function Fp(e, t) {
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
	function Ip(e, t, n) {
		if (t = CSS.escape(t) === t ? t : "r-" + btoa(t).replace(/=/g, ""), e.style.viewTransitionName = t, n != null && (e.style.viewTransitionClass = n), n = getComputedStyle(e), n.display === "inline") {
			if (t = e.getClientRects(), t.length === 1) var r = 1;
			else for (var i = r = 0; i < t.length; i++) {
				var a = t[i];
				0 < a.width && 0 < a.height && r++;
			}
			r === 1 && (e = e.style, e.display = t.length === 1 ? "inline-block" : "block", e.marginTop = "-" + n.paddingTop, e.marginBottom = "-" + n.paddingBottom);
		}
	}
	function Lp(e, t) {
		e = e.style, t = t.style;
		var n = t == null ? null : t.hasOwnProperty("viewTransitionName") ? t.viewTransitionName : t.hasOwnProperty("view-transition-name") ? t["view-transition-name"] : null;
		e.viewTransitionName = n == null || typeof n == "boolean" ? "" : ("" + n).trim(), n = t == null ? null : t.hasOwnProperty("viewTransitionClass") ? t.viewTransitionClass : t.hasOwnProperty("view-transition-class") ? t["view-transition-class"] : null, e.viewTransitionClass = n == null || typeof n == "boolean" ? "" : ("" + n).trim(), e.display === "inline-block" && (t == null ? e.display = e.margin = "" : (n = t.display, e.display = n == null || typeof n == "boolean" ? "" : n, n = t.margin, n == null ? (n = t.hasOwnProperty("marginTop") ? t.marginTop : t["margin-top"], e.marginTop = n == null || typeof n == "boolean" ? "" : n, t = t.hasOwnProperty("marginBottom") ? t.marginBottom : t["margin-bottom"], e.marginBottom = t == null || typeof t == "boolean" ? "" : t) : e.margin = n));
	}
	function Rp(e, t, n) {
		return n = n.ownerDocument.defaultView, {
			rect: e,
			abs: t.position === "absolute" || t.position === "fixed",
			clip: t.clipPath !== "none" || t.overflow !== "visible" || t.filter !== "none" || t.mask !== "none" || t.mask !== "none" || t.borderRadius !== "0px",
			view: 0 <= e.bottom && 0 <= e.right && e.top <= n.innerHeight && e.left <= n.innerWidth
		};
	}
	function zp(e) {
		return Rp(e.getBoundingClientRect(), getComputedStyle(e), e);
	}
	function Bp(e) {
		var t = e.getBoundingClientRect();
		t = new DOMRect(t.x + 2e4, t.y + 2e4, t.width, t.height);
		var n = getComputedStyle(e);
		return Rp(t, n, e);
	}
	function Vp(e) {
		return e.documentElement.clientHeight;
	}
	function Hp(e) {
		this.addEventListener("load", e), this.addEventListener("error", e);
	}
	function Up(e, t, n, r, i, a, o, s, c) {
		var l = t.nodeType === 9 ? t : t.ownerDocument;
		try {
			var u = l.startViewTransition({
				update: function() {
					var t = l.defaultView, n = t.navigation && t.navigation.transition, o = l.fonts.status;
					r();
					var s = [];
					if (o === "loaded" && (Vp(l), l.fonts.status === "loading" && s.push(l.fonts.ready)), o = s.length, e !== null) for (var c = e.suspenseyImages, u = 0, d = 0; d < c.length; d++) {
						var f = c[d];
						if (!f.complete) {
							var p = f.getBoundingClientRect();
							if (0 < p.bottom && 0 < p.right && p.top < t.innerHeight && p.left < t.innerWidth) {
								if (u += ah(f), u > ch) {
									s.length = o;
									break;
								}
								f = new Promise(Hp.bind(f)), s.push(f);
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
	function Wp(e, t) {
		this._scope = document.documentElement, this._selector = "::view-transition-" + e + "(" + t + ")";
	}
	Wp.prototype.animate = function(e, t) {
		return t = typeof t == "number" ? { duration: t } : E({}, t), t.pseudoElement = this._selector, this._scope.animate(e, t);
	}, Wp.prototype.getAnimations = function() {
		for (var e = this._scope, t = this._selector, n = e.getAnimations({ subtree: !0 }), r = [], i = 0; i < n.length; i++) {
			var a = n[i].effect;
			a !== null && a.target === e && a.pseudoElement === t && r.push(n[i]);
		}
		return r;
	}, Wp.prototype.getComputedStyle = function() {
		return getComputedStyle(this._scope, this._selector);
	};
	function Gp(e) {
		return {
			name: e,
			group: new Wp("group", e),
			imagePair: new Wp("image-pair", e),
			old: new Wp("old", e),
			new: new Wp("new", e)
		};
	}
	function Kp(e) {
		this._fragmentFiber = e, this._observers = this._eventListeners = null;
	}
	Kp.prototype.addEventListener = function(e, t, n) {
		var r = null, i = null;
		if (!(n != null && typeof n != "boolean" && (r = n.signal || null, r !== null && r.aborted))) {
			this._eventListeners === null && (this._eventListeners = []);
			var a = this._eventListeners;
			if (Zp(a, e, t, n) === -1) {
				var o = this, s = t;
				n != null && typeof n != "boolean" && !0 === n.once && (s = function(r) {
					o.removeEventListener(e, t, n), typeof t == "function" ? t.call(this, r) : t.handleEvent(r);
				}), r !== null && (i = o.removeEventListener.bind(o, e, t, n), r.addEventListener("abort", i, { once: !0 }), i = r.removeEventListener.bind(r, "abort", i)), r = Yp(n), a.push({
					type: e,
					listener: t,
					optionsOrUseCapture: n,
					attachedListener: s,
					cleanup: i
				}), h(this._fragmentFiber.child, !1, qp, e, s, r);
			}
			this._eventListeners = a;
		}
	};
	function qp(e, t, n, r) {
		return b(e).addEventListener(t, n, r), !1;
	}
	Kp.prototype.removeEventListener = function(e, t, n) {
		var r = this._eventListeners;
		if (r !== null && (t = Zp(r, e, t, n), t !== -1)) {
			var i = r[t];
			n = i.attachedListener;
			var a = i.cleanup;
			i = Yp(i.optionsOrUseCapture), h(this._fragmentFiber.child, !1, Jp, e, n, i), r.splice(t, 1), a !== null && a();
		}
	};
	function Jp(e, t, n, r) {
		return b(e).removeEventListener(t, n, r), !1;
	}
	function Yp(e) {
		return e != null && typeof e != "boolean" && (!0 === e.once || e.signal instanceof AbortSignal) ? {
			capture: e.capture,
			passive: e.passive
		} : e;
	}
	function Xp(e) {
		return e == null ? "c=0" : typeof e == "boolean" ? "c=" + (e ? "1" : "0") : "c=" + (e.capture ? "1" : "0");
	}
	function Zp(e, t, n, r) {
		if (e.length === 0) return -1;
		r = Xp(r);
		for (var i = 0; i < e.length; i++) {
			var a = e[i];
			if (a.type === t && a.listener === n && Xp(a.optionsOrUseCapture) === r) return i;
		}
		return -1;
	}
	Kp.prototype.dispatchEvent = function(e) {
		var t = g(this._fragmentFiber);
		if (t === null) return !0;
		t = b(t);
		var n = this._eventListeners;
		if (n !== null && 0 < n.length || !e.bubbles) {
			var r = t.nodeType === 9 ? t.createComment("") : document.createTextNode("");
			if (n) for (var i = 0; i < n.length; i++) {
				var a = n[i];
				r.addEventListener(a.type, a.attachedListener, Yp(a.optionsOrUseCapture));
			}
			if (t.appendChild(r), e = r.dispatchEvent(e), n) for (i = 0; i < n.length; i++) a = n[i], r.removeEventListener(a.type, a.attachedListener, Yp(a.optionsOrUseCapture));
			return t.removeChild(r), e;
		}
		return t.dispatchEvent(e);
	}, Kp.prototype.focus = function(e) {
		h(this._fragmentFiber.child, !0, Qp, e, void 0, void 0);
	};
	function Qp(e, t) {
		return e.tag !== 6 && (e = b(e), wm(e, t));
	}
	Kp.prototype.focusLast = function(e) {
		var t = [];
		h(this._fragmentFiber.child, !0, $p, t, void 0, void 0);
		for (var n = t.length - 1; 0 <= n && !Qp(t[n], e); n--);
	};
	function $p(e, t) {
		return t.push(e), !1;
	}
	Kp.prototype.blur = function() {
		var e = g(this._fragmentFiber);
		e !== null && (e = b(e), e = bp(e).activeElement, e !== null && h(this._fragmentFiber.child, !1, em, e, void 0, void 0));
	};
	function em(e, t) {
		return e.tag !== 6 && (e = b(e), e === t || e.contains(t) ? (t.blur(), !0) : !1);
	}
	Kp.prototype.observeUsing = function(e) {
		this._observers === null && (this._observers = /* @__PURE__ */ new Set()), this._observers.add(e), h(this._fragmentFiber.child, !1, tm, e, void 0, void 0);
	};
	function tm(e, t) {
		return e.tag !== 6 && (e = b(e), t.observe(e), !1);
	}
	Kp.prototype.unobserveUsing = function(e) {
		var t = this._observers;
		if (t !== null && t.has(e)) {
			t.delete(e), h(this._fragmentFiber.child, !1, nm, e, void 0, void 0);
			for (var n = t = 0; n < rm.length; n++) {
				var r = rm[n];
				r.fragmentInstance === this && r.observer === e ? e.unobserve(r.instance) : rm[t++] = r;
			}
			rm.length = t;
		}
	};
	function nm(e, t) {
		return e.tag !== 6 && (e = b(e), t.unobserve(e), !1);
	}
	var rm = [], im = !1;
	function am(e, t, n) {
		rm.push({
			fragmentInstance: e,
			observer: t,
			instance: n
		}), im || (im = !0, Tm(function() {
			im = !1;
			var e = rm;
			rm = [];
			for (var t = 0; t < e.length; t++) {
				var n = e[t];
				n.observer.unobserve(n.instance);
			}
		}));
	}
	Kp.prototype.getClientRects = function() {
		var e = [];
		return h(this._fragmentFiber.child, !1, om, e, void 0, void 0), e;
	};
	function om(e, t) {
		if (e.tag === 6) {
			e = e.stateNode;
			var n = e.ownerDocument.createRange();
			n.selectNodeContents(e), t.push.apply(t, n.getClientRects());
		} else e = b(e), t.push.apply(t, e.getClientRects());
		return !1;
	}
	Kp.prototype.getRootNode = function(e) {
		var t = g(this._fragmentFiber);
		return t === null ? this : b(t).getRootNode(e);
	}, Kp.prototype.compareDocumentPosition = function(e) {
		var t = g(this._fragmentFiber);
		if (t === null) return Node.DOCUMENT_POSITION_DISCONNECTED;
		var n = [];
		h(this._fragmentFiber.child, !1, $p, n, void 0, void 0);
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
		return s = r && a && o & Node.DOCUMENT_POSITION_FOLLOWING && s & Node.DOCUMENT_POSITION_PRECEDING, t = r && t === e || a && i === e || c || s ? Node.DOCUMENT_POSITION_CONTAINED_BY : !r && t === e || !a && i === e ? Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC : o, t & Node.DOCUMENT_POSITION_DISCONNECTED || t & Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC || sm(t, this._fragmentFiber, n[0], n[n.length - 1], e) ? t : Node.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC;
	};
	function sm(e, t, n, r, i) {
		var a = Bt(i);
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
	function cm(e, t) {
		var n = e.ownerDocument.createRange();
		n.selectNodeContents(e), e = n.getBoundingClientRect(), window.scrollTo(window.scrollX + e.left, t ? window.scrollY + e.top : window.scrollY + e.bottom - window.innerHeight);
	}
	Kp.prototype.scrollIntoView = function(e) {
		if (typeof e == "object") throw Error(i(566));
		var t = [];
		h(this._fragmentFiber.child, !1, $p, t, void 0, void 0);
		var n = !1 !== e;
		if (t.length === 0) {
			var r = v(this._fragmentFiber);
			if (r = n ? r[1] || r[0] || g(this._fragmentFiber) : r[0] || r[1], r === null) return;
			if (r.tag === 6) {
				e = b(r), cm(e, n);
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
			a.tag === 6 ? (a = b(a), cm(a, n)) : b(a).scrollIntoView(e), r += n ? -1 : 1;
		}
	};
	function lm(e, t) {
		return e = b(e), um(e, t), !1;
	}
	function um(e, t) {
		e.reactFragments ??= /* @__PURE__ */ new Set(), e.reactFragments.add(t);
	}
	function dm(e, t) {
		var n = t._eventListeners;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = n[r];
			e.addEventListener(i.type, i.attachedListener, Yp(i.optionsOrUseCapture));
		}
		e.nodeType !== 3 && (n = t._observers, n !== null && n.forEach(function(n) {
			for (var r = 0, i = 0; i < rm.length; i++) {
				var a = rm[i];
				(a.fragmentInstance !== t || a.observer !== n || a.instance !== e) && (rm[r++] = a);
			}
			rm.length = r, n.observe(e);
		}), um(e, t));
	}
	function fm(e, t) {
		var n = t._eventListeners;
		if (n !== null) for (var r = 0; r < n.length; r++) {
			var i = n[r];
			e.removeEventListener(i.type, i.attachedListener, Yp(i.optionsOrUseCapture));
		}
		e.nodeType !== 3 && (n = t._observers, n !== null && n.forEach(function(n) {
			typeof n.rootMargin == "string" ? am(t, n, e) : n.unobserve(e);
		}), e.reactFragments != null && e.reactFragments.delete(t));
	}
	function pm(e) {
		var t = e.firstChild;
		for (t && t.nodeType === 10 && (t = t.nextSibling); t;) {
			var n = t;
			switch (t = t.nextSibling, n.nodeName) {
				case "HTML":
				case "HEAD":
				case "BODY":
					pm(n), zt(n);
					continue;
				case "SCRIPT":
				case "STYLE": continue;
				case "LINK": if (n.rel.toLowerCase() === "stylesheet") continue;
			}
			e.removeChild(n);
		}
	}
	function mm(e, t, n, r) {
		for (; e.nodeType === 1;) {
			var i = n;
			if (e.nodeName.toLowerCase() !== t.toLowerCase()) {
				if (!r && (e.nodeName !== "INPUT" || e.type !== "hidden")) break;
			} else if (!r) {
				if (t === "input" && e.type === "hidden") {
					var a = i.name == null ? null : "" + i.name;
					if (i.type === "hidden" && e.getAttribute("name") === a) return e;
				} else return e;
			} else if (!e[Lt]) switch (t) {
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
			if (e = bm(e.nextSibling), e === null) break;
		}
		return null;
	}
	function hm(e, t, n) {
		if (t === "") return null;
		for (; e.nodeType !== 3;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !n || (e = bm(e.nextSibling), e === null)) return null;
		return e;
	}
	function gm(e, t) {
		for (; e.nodeType !== 8;) if ((e.nodeType !== 1 || e.nodeName !== "INPUT" || e.type !== "hidden") && !t || (e = bm(e.nextSibling), e === null)) return null;
		return e;
	}
	function _m(e) {
		return e.data === "$?" || e.data === "$~";
	}
	function vm(e) {
		return e.data === "$!" || e.data === "$?" && e.ownerDocument.readyState !== "loading";
	}
	function ym(e, t) {
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
	function bm(e) {
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
	var xm = null;
	function Sm(e) {
		e = e.nextSibling;
		for (var t = 0; e;) {
			if (e.nodeType === 8) {
				var n = e.data;
				if (n === "/$" || n === "/&") {
					if (t === 0) return bm(e.nextSibling);
					t--;
				} else n !== "$" && n !== "$!" && n !== "$?" && n !== "$~" && n !== "&" || t++;
			}
			e = e.nextSibling;
		}
		return null;
	}
	function Cm(e) {
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
	function wm(e, t) {
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
	function Tm(e) {
		Ap(function() {
			Ap(function(t) {
				return e(t);
			});
		});
	}
	function Em(e, t, n) {
		switch (t = bp(n), e) {
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
	function Dm(e, t, n) {
		for (var r in n) {
			var i = n[r];
			n.hasOwnProperty(r) && i != null && dp(e, t, r, null, mp, i);
		}
		n.dangerouslySetInnerHTML != null && (e.textContent = ""), e.onclick === En && (e.onclick = null), zt(e);
	}
	function Om(e) {
		for (var t = e.attributes; t.length;) e.removeAttributeNode(t[0]);
		zt(e);
	}
	var km = /* @__PURE__ */ new Map(), Am = /* @__PURE__ */ new Set();
	function jm(e) {
		if (typeof e.getRootNode == "function") {
			var t = e.getRootNode();
			if (t.nodeType === 9 || t.nodeType === 11) return t;
		}
		return e.nodeType === 9 ? e : e.ownerDocument;
	}
	var Mm = k.d;
	k.d = {
		f: Nm,
		r: Pm,
		D: Lm,
		C: Rm,
		L: zm,
		m: U,
		X: Vm,
		S: Bm,
		M: Hm
	};
	function Nm() {
		var e = Mm.f(), t = Jd();
		return e || t;
	}
	function Pm(e) {
		var t = Vt(e);
		t !== null && t.tag === 5 && t.type === "form" ? oc(t) : Mm.r(e);
	}
	var Fm = typeof document > "u" ? null : document;
	function Im(e, t, n) {
		var r = Fm;
		if (r && typeof t == "string" && t) {
			var i = dn(t);
			i = "link[rel=\"" + e + "\"][href=\"" + i + "\"]", typeof n == "string" && (i += "[crossorigin=\"" + n + "\"]"), Am.has(i) || (Am.add(i), e = {
				rel: e,
				crossOrigin: n,
				href: t
			}, r.querySelector(i) === null && (t = r.createElement("link"), pp(t, "link", e), Wt(t), r.head.appendChild(t)));
		}
	}
	function Lm(e) {
		Mm.D(e), Im("dns-prefetch", e, null);
	}
	function Rm(e, t) {
		Mm.C(e, t), Im("preconnect", e, t);
	}
	function zm(e, t, n) {
		Mm.L(e, t, n);
		var r = Fm;
		if (r && e && t) {
			var i = "link[rel=\"preload\"][as=\"" + dn(t) + "\"]";
			t === "image" && n && n.imageSrcSet ? (i += "[imagesrcset=\"" + dn(n.imageSrcSet) + "\"]", typeof n.imageSizes == "string" && (i += "[imagesizes=\"" + dn(n.imageSizes) + "\"]")) : i += "[href=\"" + dn(e) + "\"]";
			var a = i;
			switch (t) {
				case "style":
					a = Wm(e);
					break;
				case "script": a = Jm(e);
			}
			if (!(km.has(a) || (e = E({
				rel: "preload",
				href: t === "image" && n && n.imageSrcSet ? void 0 : e,
				as: t
			}, n), km.set(a, e), r.querySelector(i) !== null || t === "style" && r.querySelector(Gm(a)) || t === "script" && r.querySelector(Ym(a))))) {
				var o = r.createElement("link");
				pp(o, "link", e), t === "style" && (o[Rt] = !0, o.onload = o.onerror = function() {
					Gt(o);
				}), Wt(o), r.head.appendChild(o);
			}
		}
	}
	function U(e, t) {
		Mm.m(e, t);
		var n = Fm;
		if (n && e) {
			var r = t && typeof t.as == "string" ? t.as : "script", i = "link[rel=\"modulepreload\"][as=\"" + dn(r) + "\"][href=\"" + dn(e) + "\"]", a = i;
			switch (r) {
				case "audioworklet":
				case "paintworklet":
				case "serviceworker":
				case "sharedworker":
				case "worker":
				case "script": a = Jm(e);
			}
			if (!km.has(a) && (e = E({
				rel: "modulepreload",
				href: e
			}, t), km.set(a, e), n.querySelector(i) === null)) {
				switch (r) {
					case "audioworklet":
					case "paintworklet":
					case "serviceworker":
					case "sharedworker":
					case "worker":
					case "script": if (n.querySelector(Ym(a))) return;
				}
				r = n.createElement("link"), pp(r, "link", e), Wt(r), n.head.appendChild(r);
			}
		}
	}
	function Bm(e, t, n) {
		Mm.S(e, t, n);
		var r = Fm;
		if (r && e) {
			var i = Ut(r).hoistableStyles, a = Wm(e);
			t ||= "default";
			var o = i.get(a);
			if (!o) {
				var s = {
					loading: 0,
					preload: null
				};
				if (o = r.querySelector(Gm(a))) s.loading = 5;
				else {
					e = E({
						rel: "stylesheet",
						href: e,
						"data-precedence": t
					}, n), (n = km.get(a)) && Zm(e, n);
					var c = o = r.createElement("link");
					Wt(c), pp(c, "link", e), c._p = new Promise(function(e, t) {
						c.onload = e, c.onerror = t;
					}), c.addEventListener("load", function() {
						s.loading |= 1;
					}), c.addEventListener("error", function() {
						s.loading |= 2;
					}), s.loading |= 4, Xm(o, t, r);
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
	function Vm(e, t) {
		Mm.X(e, t);
		var n = Fm;
		if (n && e) {
			var r = Ut(n).hoistableScripts, i = Jm(e), a = r.get(i);
			a || (a = n.querySelector(Ym(i)), a || (e = E({
				src: e,
				async: !0
			}, t), (t = km.get(i)) && Qm(e, t), a = n.createElement("script"), Wt(a), pp(a, "link", e), n.head.appendChild(a)), a = {
				type: "script",
				instance: a,
				count: 1,
				state: null
			}, r.set(i, a));
		}
	}
	function Hm(e, t) {
		Mm.M(e, t);
		var n = Fm;
		if (n && e) {
			var r = Ut(n).hoistableScripts, i = Jm(e), a = r.get(i);
			a || (a = n.querySelector(Ym(i)), a || (e = E({
				src: e,
				async: !0,
				type: "module"
			}, t), (t = km.get(i)) && Qm(e, t), a = n.createElement("script"), Wt(a), pp(a, "link", e), n.head.appendChild(a)), a = {
				type: "script",
				instance: a,
				count: 1,
				state: null
			}, r.set(i, a));
		}
	}
	function Um(e, t, n, r) {
		var a = (a = je.current) ? jm(a) : null;
		if (!a) throw Error(i(446));
		switch (e) {
			case "meta":
			case "title": return null;
			case "style": return typeof n.precedence == "string" && typeof n.href == "string" ? (n = Wm(n.href), t = Ut(a).hoistableStyles, r = t.get(n), r || (r = {
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
					e = Wm(n.href);
					var o = Ut(a).hoistableStyles, s = o.get(e);
					if (s || (a = a.ownerDocument || a, s = {
						type: "stylesheet",
						instance: null,
						count: 0,
						state: {
							loading: 0,
							preload: null
						}
					}, o.set(e, s), (o = a.querySelector(Gm(e))) ? o._p || (s.instance = o, s.state.loading = 5) : (o = km.get(e), o || (o = {
						rel: "preload",
						as: "style",
						href: n.href,
						crossOrigin: n.crossOrigin,
						integrity: n.integrity,
						media: n.media,
						hrefLang: n.hrefLang,
						referrerPolicy: n.referrerPolicy
					}, km.set(e, o)), qm(a, e, o, s.state))), t && r === null) throw Error(i(528, ""));
					return s;
				}
				if (t && r !== null) throw Error(i(529, ""));
				return null;
			case "script": return t = n.async, n = n.src, typeof n == "string" && t && typeof t != "function" && typeof t != "symbol" ? (n = Jm(n), t = Ut(a).hoistableScripts, r = t.get(n), r || (r = {
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
	function Wm(e) {
		return "href=\"" + dn(e) + "\"";
	}
	function Gm(e) {
		return "link[rel=\"stylesheet\"][" + e + "]";
	}
	function Km(e) {
		return E({}, e, {
			"data-precedence": e.precedence,
			precedence: null
		});
	}
	function qm(e, t, n, r) {
		if (t = e.querySelector("link[rel=\"preload\"][as=\"style\"][" + t + "]")) {
			if (!0 !== t[Rt]) {
				r.loading = 1;
				return;
			}
		} else t = e.createElement("link"), t[Rt] = !0, t.onload = t.onerror = Gt.bind(null, t), pp(t, "link", n), Wt(t), e.head.appendChild(t);
		r.preload = t, t.addEventListener("load", function() {
			return r.loading |= 1;
		}), t.addEventListener("error", function() {
			return r.loading |= 2;
		});
	}
	function Jm(e) {
		return "[src=\"" + dn(e) + "\"]";
	}
	function Ym(e) {
		return "script[async]" + e;
	}
	function W(e, t, n) {
		if (t.count++, t.instance === null) switch (t.type) {
			case "style":
				var r = e.querySelector("style[data-href~=\"" + dn(n.href) + "\"]");
				if (r) return t.instance = r, Wt(r), r;
				var a = E({}, n, {
					"data-href": n.href,
					"data-precedence": n.precedence,
					href: null,
					precedence: null
				});
				return r = (e.ownerDocument || e).createElement("style"), Wt(r), pp(r, "style", a), Xm(r, n.precedence, e), t.instance = r;
			case "stylesheet":
				a = Wm(n.href);
				var o = e.querySelector(Gm(a));
				if (o) return t.state.loading |= 4, t.instance = o, Wt(o), o;
				r = Km(n), (a = km.get(a)) && Zm(r, a), o = (e.ownerDocument || e).createElement("link"), Wt(o);
				var s = o;
				return s._p = new Promise(function(e, t) {
					s.onload = e, s.onerror = t;
				}), pp(o, "link", r), t.state.loading |= 4, Xm(o, n.precedence, e), t.instance = o;
			case "script": return o = Jm(n.src), (a = e.querySelector(Ym(o))) ? (t.instance = a, Wt(a), a) : (r = n, (a = km.get(o)) && (r = E({}, n), Qm(r, a)), e = e.ownerDocument || e, a = e.createElement("script"), Wt(a), pp(a, "link", r), e.head.appendChild(a), t.instance = a);
			case "void": return null;
			default: throw Error(i(443, t.type));
		}
		else t.type === "stylesheet" && !(t.state.loading & 4) && (r = t.instance, t.state.loading |= 4, Xm(r, n.precedence, e));
		return t.instance;
	}
	function Xm(e, t, n) {
		for (var r = n.querySelectorAll("link[rel=\"stylesheet\"][data-precedence],style[data-precedence]"), i = r.length ? r[r.length - 1] : null, a = i, o = 0; o < r.length; o++) {
			var s = r[o];
			if (s.dataset.precedence === t) a = s;
			else if (a !== i) break;
		}
		a ? a.parentNode.insertBefore(e, a.nextSibling) : (t = n.nodeType === 9 ? n.head : n, t.insertBefore(e, t.firstChild));
	}
	function Zm(e, t) {
		e.crossOrigin ??= t.crossOrigin, e.referrerPolicy ??= t.referrerPolicy, e.title ??= t.title;
	}
	function Qm(e, t) {
		e.crossOrigin ??= t.crossOrigin, e.referrerPolicy ??= t.referrerPolicy, e.integrity ??= t.integrity;
	}
	var $m = null;
	function eh(e, t, n) {
		if ($m === null) {
			var r = /* @__PURE__ */ new Map(), i = $m = /* @__PURE__ */ new Map();
			i.set(n, r);
		} else i = $m, r = i.get(n), r || (r = /* @__PURE__ */ new Map(), i.set(n, r));
		if (r.has(e)) return r;
		for (r.set(e, null), n = n.getElementsByTagName(e), i = 0; i < n.length; i++) {
			var a = n[i];
			if (!(a[Lt] || a[At] || e === "link" && a.getAttribute("rel") === "stylesheet") && a.namespaceURI !== "http://www.w3.org/2000/svg") {
				var o = a.getAttribute(t) || "";
				o = e + o;
				var s = r.get(o);
				s ? s.push(a) : r.set(o, [a]);
			}
		}
		return r;
	}
	function th(e, t, n) {
		e = e.ownerDocument || e, e.head.insertBefore(n, t === "title" ? e.querySelector("head > title") : null);
	}
	function nh(e, t, n) {
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
	function rh(e, t) {
		return e === "img" && t.src != null && t.src !== "" && t.onLoad == null && t.loading !== "lazy";
	}
	function ih(e) {
		return !(e.type === "stylesheet" && !(e.state.loading & 3));
	}
	function ah(e) {
		return (e.width || 100) * (e.height || 100) * (typeof devicePixelRatio == "number" ? devicePixelRatio : 1) * .25;
	}
	function oh(e, t) {
		typeof t.decode == "function" && (e.imgCount++, t.complete || (e.imgBytes += ah(t), e.suspenseyImages.push(t)), e = fh.bind(e), t.decode().then(e, e));
	}
	function sh(e, t, n, r) {
		if (n.type === "stylesheet" && (typeof r.media != "string" || !1 !== matchMedia(r.media).matches) && !(n.state.loading & 4)) {
			if (n.instance === null) {
				var i = Wm(r.href), a = t.querySelector(Gm(i));
				if (a) {
					t = a._p, typeof t == "object" && t && typeof t.then == "function" && (e.count++, e = dh.bind(e), t.then(e, e)), n.state.loading |= 4, n.instance = a, Wt(a);
					return;
				}
				a = t.ownerDocument || t, r = Km(r), (i = km.get(i)) && Zm(r, i), a = a.createElement("link"), Wt(a);
				var o = a;
				o._p = new Promise(function(e, t) {
					o.onload = e, o.onerror = t;
				}), pp(a, "link", r), n.instance = a;
			}
			e.stylesheets === null && (e.stylesheets = /* @__PURE__ */ new Map()), e.stylesheets.set(n, t), (t = n.state.preload) && !(n.state.loading & 3) && (e.count++, n = dh.bind(e), t.addEventListener("load", n), t.addEventListener("error", n));
		}
	}
	var ch = 0;
	function lh(e, t) {
		return e.stylesheets && e.count === 0 && mh(e, e.stylesheets), 0 < e.count || 0 < e.imgCount ? function(n) {
			var r = setTimeout(function() {
				if (e.stylesheets && mh(e, e.stylesheets), e.unsuspend) {
					var t = e.unsuspend;
					e.unsuspend = null, t();
				}
			}, 6e4 + t);
			0 < e.imgBytes && ch === 0 && (ch = 62500 * _p());
			var i = setTimeout(function() {
				if (e.waitingForImages = !1, e.count === 0 && (e.stylesheets && mh(e, e.stylesheets), e.unsuspend)) {
					var t = e.unsuspend;
					e.unsuspend = null, t();
				}
			}, (e.imgBytes > ch ? 50 : 800) + t);
			return e.unsuspend = n, function() {
				e.unsuspend = null, clearTimeout(r), clearTimeout(i);
			};
		} : null;
	}
	function uh(e) {
		if (e.count === 0 && (e.imgCount === 0 || !e.waitingForImages)) {
			if (e.stylesheets) mh(e, e.stylesheets);
			else if (e.unsuspend) {
				var t = e.unsuspend;
				e.unsuspend = null, t();
			}
		}
	}
	function dh() {
		this.count--, uh(this);
	}
	function fh() {
		this.imgCount--, uh(this);
	}
	var ph = null;
	function mh(e, t) {
		e.stylesheets = null, e.unsuspend !== null && (e.count++, ph = /* @__PURE__ */ new Map(), t.forEach(hh, e), ph = null, dh.call(e));
	}
	function hh(e, t) {
		if (!(t.state.loading & 4)) {
			var n = ph.get(e);
			if (n) var r = n.get(null);
			else {
				n = /* @__PURE__ */ new Map(), ph.set(e, n);
				for (var i = e.querySelectorAll("link[data-precedence],style[data-precedence]"), a = 0; a < i.length; a++) {
					var o = i[a];
					(o.nodeName === "LINK" || o.getAttribute("media") !== "not all") && (n.set(o.dataset.precedence, o), r = o);
				}
				r && n.set(null, r);
			}
			i = t.instance, o = i.getAttribute("data-precedence"), a = n.get(o) || r, a === r && n.set(null, i), n.set(o, i), this.count++, r = dh.bind(this), i.addEventListener("load", r), i.addEventListener("error", r), a ? a.parentNode.insertBefore(i, a.nextSibling) : (e = e.nodeType === 9 ? e.head : e, e.insertBefore(i, e.firstChild)), t.state.loading |= 4;
		}
	}
	var gh = {
		$$typeof: se,
		Provider: null,
		Consumer: null,
		_currentValue: Ce,
		_currentValue2: Ce,
		_threadCount: 0
	};
	function _h(e, t, n, r, i, a, o, s, c) {
		this.tag = 1, this.containerInfo = e, this.pingCache = this.current = this.pendingChildren = null, this.timeoutHandle = -1, this.callbackNode = this.next = this.pendingContext = this.context = this.cancelPendingCommit = null, this.callbackPriority = 0, this.expirationTimes = yt(-1), this.entangledLanes = this.shellSuspendCounter = this.errorRecoveryDisabledLanes = this.expiredLanes = this.warmLanes = this.pingedLanes = this.suspendedLanes = this.pendingLanes = 0, this.entanglements = yt(0), this.hiddenUpdates = yt(null), this.identifierPrefix = r, this.onUncaughtError = i, this.onCaughtError = a, this.onRecoverableError = o, this.pooledCache = null, this.pooledCacheLanes = 0, this.formState = c, this.transitionTypes = null, this.incompleteTransitions = /* @__PURE__ */ new Map();
	}
	function vh(e, t, n, r, i, a, o, s, c, l, u, d) {
		return e = new _h(e, t, n, o, c, l, u, d, s), t = 1, !0 === a && (t |= 24), a = Li(3, null, null, t), e.current = a, a.stateNode = e, t = Pa(), t.refCount++, e.pooledCache = t, t.refCount++, a.memoizedState = {
			element: r,
			isDehydrated: n,
			cache: t
		}, _o(a), e;
	}
	function yh(e) {
		return e ? (e = Fi, e) : Fi;
	}
	function bh(e, t, n, r, i, a) {
		i = yh(i), r.context === null ? r.context = i : r.pendingContext = i, r = yo(t), r.payload = { element: n }, a = a === void 0 ? null : a, a !== null && (r.callback = a), n = bo(e, r, t), n !== null && (Ud(n, e, t), xo(n, e, t));
	}
	function xh(e, t) {
		if (e = e.memoizedState, e !== null && e.dehydrated !== null) {
			var n = e.retryLane;
			e.retryLane = n !== 0 && n < t ? n : t;
		}
	}
	function Sh(e, t) {
		xh(e, t), (e = e.alternate) && xh(e, t);
	}
	function Ch(e) {
		if (e.tag === 13 || e.tag === 31) {
			var t = Mi(e, 67108864);
			t !== null && Ud(t, e, 67108864), Sh(e, 67108864);
		}
	}
	function wh(e) {
		if (e.tag === 13 || e.tag === 31) {
			var t = Bd();
			t = Tt(t);
			var n = Mi(e, t);
			n !== null && Ud(n, e, t), Sh(e, t);
		}
	}
	var Th = !0;
	function Eh(e, t, n, r) {
		var i = O.T;
		O.T = null;
		var a = k.p;
		try {
			k.p = 2, Oh(e, t, n, r);
		} finally {
			k.p = a, O.T = i;
		}
	}
	function Dh(e, t, n, r) {
		var i = O.T;
		O.T = null;
		var a = k.p;
		try {
			k.p = 8, Oh(e, t, n, r);
		} finally {
			k.p = a, O.T = i;
		}
	}
	function Oh(e, t, n, r) {
		if (Th) {
			var i = kh(r);
			if (i === null) np(e, t, r, Ah, n), G(e, r);
			else if (K(i, e, t, n, r)) r.stopPropagation();
			else if (G(e, r), t & 4 && -1 < Bh.indexOf(e)) {
				for (; i !== null;) {
					var a = Vt(i);
					if (a !== null) switch (a.tag) {
						case 3:
							if (a = a.stateNode, a.current.memoizedState.isDehydrated) {
								var o = pt(a.pendingLanes);
								if (o !== 0) {
									var s = a;
									for (s.pendingLanes |= 2, s.entangledLanes |= 2; o;) {
										var c = 1 << 31 - ot(o);
										s.entanglements[1] |= c, o &= ~c;
									}
									If(a), !(od & 6) && (Td = Je() + 500, Lf(0, !1));
								}
							}
							break;
						case 31:
						case 13: s = Mi(a, 2), s !== null && Ud(s, a, 2), Jd(), Sh(a, 2);
					}
					if (a = kh(r), a === null && np(e, t, r, Ah, n), a === i) break;
					i = a;
				}
				i !== null && r.stopPropagation();
			} else np(e, t, r, null, n);
		}
	}
	function kh(e) {
		return e = On(e), jh(e);
	}
	var Ah = null;
	function jh(e) {
		if (Ah = null, e = Bt(e), e !== null) {
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
		return Ah = e, null;
	}
	function Mh(e) {
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
			case "message": switch (Ye()) {
				case Xe: return 2;
				case Ze: return 8;
				case Qe:
				case $e: return 32;
				case et: return 268435456;
				default: return 32;
			}
			default: return 32;
		}
	}
	var Nh = !1, Ph = null, Fh = null, Ih = null, Lh = /* @__PURE__ */ new Map(), Rh = /* @__PURE__ */ new Map(), zh = [], Bh = "mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset".split(" ");
	function G(e, t) {
		switch (e) {
			case "focusin":
			case "focusout":
				Ph = null;
				break;
			case "dragenter":
			case "dragleave":
				Fh = null;
				break;
			case "mouseover":
			case "mouseout":
				Ih = null;
				break;
			case "pointerover":
			case "pointerout":
				Lh.delete(t.pointerId);
				break;
			case "gotpointercapture":
			case "lostpointercapture": Rh.delete(t.pointerId);
		}
	}
	function Vh(e, t, n, r, i, a) {
		return e === null || e.nativeEvent !== a ? (e = {
			blockedOn: t,
			domEventName: n,
			eventSystemFlags: r,
			nativeEvent: a,
			targetContainers: [i]
		}, t !== null && (t = Vt(t), t !== null && Ch(t)), e) : (e.eventSystemFlags |= r, t = e.targetContainers, i !== null && t.indexOf(i) === -1 && t.push(i), e);
	}
	function K(e, t, n, r, i) {
		switch (t) {
			case "focusin": return Ph = Vh(Ph, e, t, n, r, i), !0;
			case "dragenter": return Fh = Vh(Fh, e, t, n, r, i), !0;
			case "mouseover": return Ih = Vh(Ih, e, t, n, r, i), !0;
			case "pointerover":
				var a = i.pointerId;
				return Lh.set(a, Vh(Lh.get(a) || null, e, t, n, r, i)), !0;
			case "gotpointercapture": return a = i.pointerId, Rh.set(a, Vh(Rh.get(a) || null, e, t, n, r, i)), !0;
		}
		return !1;
	}
	function q(e) {
		var t = Bt(e.target);
		if (t !== null) {
			var n = o(t);
			if (n !== null) {
				if (t = n.tag, t === 13) {
					if (t = s(n), t !== null) {
						e.blockedOn = t, Ot(e.priority, function() {
							wh(n);
						});
						return;
					}
				} else if (t === 31) {
					if (t = c(n), t !== null) {
						e.blockedOn = t, Ot(e.priority, function() {
							wh(n);
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
	function Hh(e) {
		if (e.blockedOn !== null) return !1;
		for (var t = e.targetContainers; 0 < t.length;) {
			var n = kh(e.nativeEvent);
			if (n === null) {
				n = e.nativeEvent;
				var r = new n.constructor(n.type, n);
				Dn = r, n.target.dispatchEvent(r), Dn = null;
			} else return t = Vt(n), t !== null && Ch(t), e.blockedOn = n, !1;
			t.shift();
		}
		return !0;
	}
	function Uh(e, t, n) {
		Hh(e) && n.delete(t);
	}
	function J() {
		Nh = !1, Ph !== null && Hh(Ph) && (Ph = null), Fh !== null && Hh(Fh) && (Fh = null), Ih !== null && Hh(Ih) && (Ih = null), Lh.forEach(Uh), Rh.forEach(Uh);
	}
	function Wh(e, n) {
		e.blockedOn === n && (e.blockedOn = null, Nh || (Nh = !0, t.unstable_scheduleCallback(t.unstable_NormalPriority, J)));
	}
	var Gh = null;
	function Kh(e) {
		Gh !== e && (Gh = e, t.unstable_scheduleCallback(t.unstable_NormalPriority, function() {
			Gh === e && (Gh = null);
			for (var t = 0; t < e.length; t += 3) {
				var n = e[t], r = e[t + 1], i = e[t + 2];
				if (typeof r != "function") {
					if (jh(r || n) === null) continue;
					break;
				}
				var a = Vt(n);
				a !== null && (e.splice(t, 3), t -= 3, ic(a, {
					pending: !0,
					data: i,
					method: n.method,
					action: r
				}, r, i));
			}
		}));
	}
	function qh(e) {
		function t(t) {
			return Wh(t, e);
		}
		Ph !== null && Wh(Ph, e), Fh !== null && Wh(Fh, e), Ih !== null && Wh(Ih, e), Lh.forEach(t), Rh.forEach(t);
		for (var n = 0; n < zh.length; n++) {
			var r = zh[n];
			r.blockedOn === e && (r.blockedOn = null);
		}
		for (; 0 < zh.length && (n = zh[0], n.blockedOn === null);) q(n), n.blockedOn === null && zh.shift();
		if (n = (e.ownerDocument || e).$$reactFormReplay, n != null) for (r = 0; r < n.length; r += 3) {
			var i = n[r], a = n[r + 1], o = i[jt] || null;
			if (typeof a == "function") o || Kh(n);
			else if (o) {
				var s = null;
				if (a && a.hasAttribute("formAction")) {
					if (i = a, o = a[jt] || null) s = o.formAction;
					else if (jh(i) !== null) continue;
				} else s = o.action;
				typeof s == "function" ? n[r + 1] = s : (n.splice(r, 3), r -= 3), Kh(n);
			}
		}
	}
	function Jh() {
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
	function Yh(e) {
		this._internalRoot = e;
	}
	Xh.prototype.render = Yh.prototype.render = function(e) {
		var t = this._internalRoot;
		if (t === null) throw Error(i(409));
		var n = t.current;
		bh(n, Bd(), e, t, null, null);
	}, Xh.prototype.unmount = Yh.prototype.unmount = function() {
		var e = this._internalRoot;
		if (e !== null) {
			this._internalRoot = null;
			var t = e.containerInfo;
			bh(e.current, 2, null, e, null, null), Jd(), t[Mt] = null;
		}
	};
	function Xh(e) {
		this._internalRoot = e;
	}
	Xh.prototype.unstable_scheduleHydration = function(e) {
		if (e) {
			var t = Dt();
			e = {
				blockedOn: null,
				target: e,
				priority: t
			};
			for (var n = 0; n < zh.length && t !== 0 && t < zh[n].priority; n++);
			zh.splice(n, 0, e), n === 0 && q(e);
		}
	};
	var Zh = n.version;
	if (Zh !== "19.3.0") throw Error(i(527, Zh, "19.3.0"));
	k.findDOMNode = function(e) {
		var t = e._reactInternals;
		if (t === void 0) throw typeof e.render == "function" ? Error(i(188)) : (e = Object.keys(e).join(","), Error(i(268, e)));
		return e = d(t), e = e === null ? null : p(e), e = e === null ? null : e.stateNode, e;
	};
	var Qh = {
		bundleType: 0,
		version: "19.3.0",
		rendererPackageName: "react-dom",
		currentDispatcherRef: O,
		reconcilerVersion: "19.3.0"
	};
	if (typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < "u") {
		var $h = __REACT_DEVTOOLS_GLOBAL_HOOK__;
		if (!$h.isDisabled && $h.supportsFiber) try {
			rt = $h.inject(Qh), it = $h;
		} catch {}
	}
	e.createRoot = function(e, t) {
		if (!a(e)) throw Error(i(299));
		var n = !1, r = "", o = Dc, s = Oc, c = kc;
		return t != null && (!0 === t.unstable_strictMode && (n = !0), t.identifierPrefix !== void 0 && (r = t.identifierPrefix), t.onUncaughtError !== void 0 && (o = t.onUncaughtError), t.onCaughtError !== void 0 && (s = t.onCaughtError), t.onRecoverableError !== void 0 && (c = t.onRecoverableError)), t = vh(e, 1, !1, null, null, n, r, null, o, s, c, Jh), e[Mt] = t.current, ep(e), new Yh(t);
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
	let n = t && t.cache ? t.cache : ne, r = t && t.serializer ? t.serializer : E;
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
}, ne = { create: function() {
	return new te();
} }, D = {
	variadic: T,
	monadic: ee
}, re = /(?:[Eec]{1,6}|G{1,5}|[Qq]{1,5}|(?:[yYur]+|U{1,5})|[ML]{1,5}|d{1,2}|D{1,3}|F{1}|[abB]{1,5}|[hkHK]{1,2}|w{1,2}|W{1}|m{1,2}|s{1,2}|[zZOvVxX]{1,4})(?=([^']*'[^']*')*[^']*$)/g;
function ie(e) {
	let t = {};
	return e.replace(re, (e) => {
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
var ae = /[\t-\r \x85\u200E\u200F\u2028\u2029]/i;
function oe(e) {
	if (e.length === 0) throw Error("Number skeleton cannot be empty");
	let t = e.split(ae).filter((e) => e.length > 0), n = [];
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
function se(e) {
	return e.replace(/^(.*?)-/, "");
}
var ce = /^\.(?:(0+)(\*)?|(#+)|(0+)(#+))$/g, le = /^(@+)?(\+|#+)?[rs]?$/g, ue = /(\*)(0+)|(#+)(0+)|(0+)/g, de = /^(0+)$/;
function fe(e) {
	let t = {};
	return e[e.length - 1] === "r" ? t.roundingPriority = "morePrecision" : e[e.length - 1] === "s" && (t.roundingPriority = "lessPrecision"), e.replace(le, function(e, n, r) {
		return typeof r == "string" ? r === "+" ? t.minimumSignificantDigits = n.length : n[0] === "#" ? t.maximumSignificantDigits = n.length : (t.minimumSignificantDigits = n.length, t.maximumSignificantDigits = n.length + (typeof r == "string" ? r.length : 0)) : (t.minimumSignificantDigits = n.length, t.maximumSignificantDigits = n.length), "";
	}), t;
}
function pe(e) {
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
function me(e) {
	let t;
	if (e[0] === "E" && e[1] === "E" ? (t = { notation: "engineering" }, e = e.slice(2)) : e[0] === "E" && (t = { notation: "scientific" }, e = e.slice(1)), t) {
		let n = e.slice(0, 2);
		if (n === "+!" ? (t.signDisplay = "always", e = e.slice(2)) : n === "+?" && (t.signDisplay = "exceptZero", e = e.slice(2)), !de.test(e)) throw Error("Malformed concise eng/scientific notation");
		t.minimumIntegerDigits = e.length;
	}
	return t;
}
function he(e) {
	return pe(e) || {};
}
function ge(e) {
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
				t.style = "unit", t.unit = se(n.options[0]);
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
						...he(t)
					}), {})
				};
				continue;
			case "engineering":
				t = {
					...t,
					notation: "engineering",
					...n.options.reduce((e, t) => ({
						...e,
						...he(t)
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
				n.options[0].replace(ue, function(e, n, r, i, a, o) {
					if (n) t.minimumIntegerDigits = r.length;
					else if (i && a) throw Error("We currently do not support maximum integer digits");
					else if (o) throw Error("We currently do not support exact integer digits");
					return "";
				});
				continue;
		}
		if (de.test(n.stem)) {
			t.minimumIntegerDigits = n.stem.length;
			continue;
		}
		if (ce.test(n.stem)) {
			if (n.options.length > 1) throw RangeError("Fraction-precision stems only accept a single optional option");
			n.stem.replace(ce, function(e, n, r, i, a, o) {
				return r === "*" ? t.minimumFractionDigits = n.length : i && i[0] === "#" ? t.maximumFractionDigits = i.length : a && o ? (t.minimumFractionDigits = a.length, t.maximumFractionDigits = a.length + o.length) : (t.minimumFractionDigits = n.length, t.maximumFractionDigits = n.length), "";
			});
			let e = n.options[0];
			e === "w" ? t = {
				...t,
				trailingZeroDisplay: "stripIfInteger"
			} : e && (t = {
				...t,
				...fe(e)
			});
			continue;
		}
		if (le.test(n.stem)) {
			t = {
				...t,
				...fe(n.stem)
			};
			continue;
		}
		let e = pe(n.stem);
		e && (t = {
			...t,
			...e
		});
		let r = me(n.stem);
		r && (t = {
			...t,
			...r
		});
	}
	return t;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/@formatjs/icu-messageformat-parser/index.js
var _e = /* @__PURE__ */ function(e) {
	return e[e.EXPECT_ARGUMENT_CLOSING_BRACE = 1] = "EXPECT_ARGUMENT_CLOSING_BRACE", e[e.EMPTY_ARGUMENT = 2] = "EMPTY_ARGUMENT", e[e.MALFORMED_ARGUMENT = 3] = "MALFORMED_ARGUMENT", e[e.EXPECT_ARGUMENT_TYPE = 4] = "EXPECT_ARGUMENT_TYPE", e[e.INVALID_ARGUMENT_TYPE = 5] = "INVALID_ARGUMENT_TYPE", e[e.EXPECT_ARGUMENT_STYLE = 6] = "EXPECT_ARGUMENT_STYLE", e[e.INVALID_NUMBER_SKELETON = 7] = "INVALID_NUMBER_SKELETON", e[e.INVALID_DATE_TIME_SKELETON = 8] = "INVALID_DATE_TIME_SKELETON", e[e.EXPECT_NUMBER_SKELETON = 9] = "EXPECT_NUMBER_SKELETON", e[e.EXPECT_DATE_TIME_SKELETON = 10] = "EXPECT_DATE_TIME_SKELETON", e[e.UNCLOSED_QUOTE_IN_ARGUMENT_STYLE = 11] = "UNCLOSED_QUOTE_IN_ARGUMENT_STYLE", e[e.EXPECT_SELECT_ARGUMENT_OPTIONS = 12] = "EXPECT_SELECT_ARGUMENT_OPTIONS", e[e.EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE = 13] = "EXPECT_PLURAL_ARGUMENT_OFFSET_VALUE", e[e.INVALID_PLURAL_ARGUMENT_OFFSET_VALUE = 14] = "INVALID_PLURAL_ARGUMENT_OFFSET_VALUE", e[e.EXPECT_SELECT_ARGUMENT_SELECTOR = 15] = "EXPECT_SELECT_ARGUMENT_SELECTOR", e[e.EXPECT_PLURAL_ARGUMENT_SELECTOR = 16] = "EXPECT_PLURAL_ARGUMENT_SELECTOR", e[e.EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT = 17] = "EXPECT_SELECT_ARGUMENT_SELECTOR_FRAGMENT", e[e.EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT = 18] = "EXPECT_PLURAL_ARGUMENT_SELECTOR_FRAGMENT", e[e.INVALID_PLURAL_ARGUMENT_SELECTOR = 19] = "INVALID_PLURAL_ARGUMENT_SELECTOR", e[e.DUPLICATE_PLURAL_ARGUMENT_SELECTOR = 20] = "DUPLICATE_PLURAL_ARGUMENT_SELECTOR", e[e.DUPLICATE_SELECT_ARGUMENT_SELECTOR = 21] = "DUPLICATE_SELECT_ARGUMENT_SELECTOR", e[e.MISSING_OTHER_CLAUSE = 22] = "MISSING_OTHER_CLAUSE", e[e.INVALID_TAG = 23] = "INVALID_TAG", e[e.INVALID_TAG_NAME = 25] = "INVALID_TAG_NAME", e[e.UNMATCHED_CLOSING_TAG = 26] = "UNMATCHED_CLOSING_TAG", e[e.UNCLOSED_TAG = 27] = "UNCLOSED_TAG", e;
}({}), ve = /* @__PURE__ */ function(e) {
	return e[e.literal = 0] = "literal", e[e.argument = 1] = "argument", e[e.number = 2] = "number", e[e.date = 3] = "date", e[e.time = 4] = "time", e[e.select = 5] = "select", e[e.plural = 6] = "plural", e[e.pound = 7] = "pound", e[e.tag = 8] = "tag", e;
}({});
function ye(e) {
	return e.type === 0;
}
function be(e) {
	return e.type === 1;
}
function xe(e) {
	return e.type === 2;
}
function Se(e) {
	return e.type === 3;
}
function O(e) {
	return e.type === 4;
}
function k(e) {
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
function A(e, t) {
	return {
		start: e,
		end: t
	};
}
var Fe = !!Object.fromEntries, Ie = !!String.prototype.trimStart, Le = !!String.prototype.trimEnd, Re = Fe ? Object.fromEntries : function(e) {
	let t = {};
	for (let [n, r] of e) t[n] = r;
	return t;
}, ze = Ie ? function(e) {
	return e.trimStart();
} : function(e) {
	return e.replace(Ne, "");
}, Be = Le ? function(e) {
	return e.trimEnd();
} : function(e) {
	return e.replace(Pe, "");
}, Ve = He();
function He() {
	try {
		let e = /* @__PURE__ */ RegExp("([^\\p{White_Space}\\p{Pattern_Syntax}]*)", "yu");
		if (e.exec("a ")?.[1] === "a") return e;
	} catch {}
	return ke;
}
function Ue(e, t) {
	return Ve.lastIndex = t, Ve.exec(e)[1] ?? "";
}
function We(e) {
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
var Ge = class {
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
				let e = We(this.message);
				if (e) {
					let t = this.clonePosition();
					return this.position = e, {
						val: [{
							type: 0,
							value: this.message,
							location: A(t, this.clonePosition())
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
					location: A(e, this.clonePosition())
				});
			} else if (i === 60 && !this.ignoreTag && this.peek() === 47) {
				if (n) break;
				return this.error(26, A(this.clonePosition(), this.clonePosition()));
			} else if (i === 60 && !this.ignoreTag && Ke(this.peek() || 0)) {
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
				location: A(n, this.clonePosition())
			},
			err: null
		};
		if (this.bumpIf(">")) {
			let i = this.parseMessage(e + 1, t, !0);
			if (i.err) return i;
			let a = i.val, o = this.clonePosition();
			if (this.bumpIf("</")) {
				if (this.isEOF() || !Ke(this.char())) return this.error(23, A(o, this.clonePosition()));
				let e = this.clonePosition();
				return r === this.parseTagName() ? (this.bumpSpace(), this.bumpIf(">") ? {
					val: {
						type: 8,
						value: r,
						children: a,
						location: A(n, this.clonePosition())
					},
					err: null
				} : this.error(23, A(o, this.clonePosition()))) : this.error(26, A(e, this.clonePosition()));
			}
			return this.error(27, A(n, this.clonePosition()));
		}
		return this.error(23, A(n, this.clonePosition()));
	}
	parseTagName() {
		let e = this.offset();
		for (this.bump(); !this.isEOF() && Je(this.char());) this.bump();
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
		let i = A(n, this.clonePosition());
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
		return !this.isEOF() && this.char() === 60 && (this.ignoreTag || !qe(this.peek() || 0)) ? (this.bump(), "<") : null;
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
		if (this.bump(), this.bumpSpace(), this.isEOF()) return this.error(1, A(n, this.clonePosition()));
		if (this.char() === 125) return this.bump(), this.error(2, A(n, this.clonePosition()));
		let r = this.parseIdentifierIfPossible().value;
		if (!r) return this.error(3, A(n, this.clonePosition()));
		if (this.bumpSpace(), this.isEOF()) return this.error(1, A(n, this.clonePosition()));
		switch (this.char()) {
			case 125: return this.bump(), {
				val: {
					type: 1,
					value: r,
					location: A(n, this.clonePosition())
				},
				err: null
			};
			case 44: return this.bump(), this.bumpSpace(), this.isEOF() ? this.error(1, A(n, this.clonePosition())) : this.parseArgumentOptions(e, t, r, n);
			default: return this.error(3, A(n, this.clonePosition()));
		}
	}
	parseIdentifierIfPossible() {
		let e = this.clonePosition(), t = this.offset(), n = Ue(this.message, t), r = t + n.length;
		return this.bumpTo(r), {
			value: n,
			location: A(e, this.clonePosition())
		};
	}
	parseArgumentOptions(e, t, n, r) {
		let i = this.clonePosition(), a = this.parseIdentifierIfPossible().value, o = this.clonePosition();
		switch (a) {
			case "": return this.error(4, A(i, o));
			case "number":
			case "date":
			case "time": {
				this.bumpSpace();
				let e = null;
				if (this.bumpIf(",")) {
					this.bumpSpace();
					let t = this.clonePosition(), n = this.parseSimpleArgStyleIfPossible();
					if (n.err) return n;
					let r = Be(n.val);
					if (r.length === 0) return this.error(6, A(this.clonePosition(), this.clonePosition()));
					e = {
						style: r,
						styleLocation: A(t, this.clonePosition())
					};
				}
				let t = this.tryParseArgumentClose(r);
				if (t.err) return t;
				let i = A(r, this.clonePosition());
				if (e && e.style.startsWith("::")) {
					let t = ze(e.style.slice(2));
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
							parsedOptions: this.shouldParseSkeletons ? ie(r) : {}
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
				if (this.bumpSpace(), !this.bumpIf(",")) return this.error(12, A(i, { ...i }));
				this.bumpSpace();
				let o = this.parseIdentifierIfPossible(), s = 0;
				if (a !== "select" && o.value === "offset") {
					if (!this.bumpIf(":")) return this.error(13, A(this.clonePosition(), this.clonePosition()));
					this.bumpSpace();
					let e = this.tryParseDecimalInteger(13, 14);
					if (e.err) return e;
					this.bumpSpace(), o = this.parseIdentifierIfPossible(), s = e.val;
				}
				let c = this.tryParsePluralOrSelectOptions(e, a, t, o);
				if (c.err) return c;
				let l = this.tryParseArgumentClose(r);
				if (l.err) return l;
				let u = A(r, this.clonePosition());
				return a === "select" ? {
					val: {
						type: 5,
						value: n,
						options: Re(c.val),
						location: u
					},
					err: null
				} : {
					val: {
						type: 6,
						value: n,
						options: Re(c.val),
						offset: s,
						pluralType: a === "plural" ? "cardinal" : "ordinal",
						location: u
					},
					err: null
				};
			}
			default: return this.error(5, A(i, o));
		}
	}
	tryParseArgumentClose(e) {
		return this.isEOF() || this.char() !== 125 ? this.error(1, A(e, this.clonePosition())) : (this.bump(), {
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
				if (!this.bumpUntil("'")) return this.error(11, A(e, this.clonePosition()));
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
			n = oe(e);
		} catch {
			return this.error(7, t);
		}
		return {
			val: {
				type: 0,
				tokens: n,
				location: t,
				parsedOptions: this.shouldParseSkeletons ? ge(n) : {}
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
					c = A(e, this.clonePosition()), s = this.message.slice(e.offset, this.offset());
				} else break;
			}
			if (o.has(s)) return this.error(t === "select" ? 21 : 20, c);
			s === "other" && (i = !0), this.bumpSpace();
			let r = this.clonePosition();
			if (!this.bumpIf("{")) return this.error(t === "select" ? 17 : 18, A(this.clonePosition(), this.clonePosition()));
			let l = this.parseMessage(e + 1, t, n);
			if (l.err) return l;
			let u = this.tryParseArgumentClose(r);
			if (u.err) return u;
			a.push([s, {
				value: l.val,
				location: A(r, this.clonePosition())
			}]), o.add(s), this.bumpSpace(), {value: s, location: c} = this.parseIdentifierIfPossible();
		}
		return a.length === 0 ? this.error(t === "select" ? 15 : 16, A(this.clonePosition(), this.clonePosition())) : this.requiresOtherClause && !i ? this.error(22, A(this.clonePosition(), this.clonePosition())) : {
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
		let o = A(r, this.clonePosition());
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
		for (; !this.isEOF() && Ye(this.char());) this.bump();
	}
	peek() {
		if (this.isEOF()) return null;
		let e = this.char(), t = this.offset();
		return this.message.charCodeAt(t + (e >= 65536 ? 2 : 1)) ?? null;
	}
};
function Ke(e) {
	return e >= 97 && e <= 122 || e >= 65 && e <= 90;
}
function qe(e) {
	return Ke(e) || e === 47;
}
function Je(e) {
	return e === 45 || e === 46 || e >= 48 && e <= 57 || e === 95 || e >= 97 && e <= 122 || e >= 65 && e <= 90 || e == 183 || e >= 192 && e <= 214 || e >= 216 && e <= 246 || e >= 248 && e <= 893 || e >= 895 && e <= 8191 || e >= 8204 && e <= 8205 || e >= 8255 && e <= 8256 || e >= 8304 && e <= 8591 || e >= 11264 && e <= 12271 || e >= 12289 && e <= 55295 || e >= 63744 && e <= 64975 || e >= 65008 && e <= 65533 || e >= 65536 && e <= 983039;
}
function Ye(e) {
	return e >= 9 && e <= 13 || e === 32 || e === 133 || e >= 8206 && e <= 8207 || e === 8232 || e === 8233;
}
function Xe(e) {
	e.forEach((e) => {
		if (delete e.location, k(e) || Ce(e)) for (let t in e.options) delete e.options[t].location, Xe(e.options[t].value);
		else xe(e) && Ee(e.style) || (Se(e) || O(e)) && De(e.style) ? delete e.style.location : Te(e) && Xe(e.children);
	});
}
function Ze(e, t = {}) {
	t = {
		shouldParseSkeletons: !0,
		requiresOtherClause: !0,
		...t
	};
	let n = new Ge(e, t).parse();
	if (n.err) {
		let e = SyntaxError(_e[n.err.kind]);
		throw e.location = n.err.location, e.originalMessage = n.err.message, e;
	}
	return t?.captureLocation || Xe(n.val), n.val;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/intl-messageformat/index.js
var Qe = /* @__PURE__ */ function(e) {
	return e.MISSING_VALUE = "MISSING_VALUE", e.INVALID_VALUE = "INVALID_VALUE", e.MISSING_INTL_API = "MISSING_INTL_API", e;
}({}), $e = class extends Error {
	constructor(e, t, n) {
		super(e), this.code = t, this.originalMessage = n;
	}
	toString() {
		return `[formatjs Error: ${this.code}] ${this.message}`;
	}
}, et = class extends $e {
	constructor(e, t, n, r) {
		super(`Invalid values for "${e}": "${t}". Options are "${Object.keys(n).join("\", \"")}"`, "INVALID_VALUE", r);
	}
}, tt = class extends $e {
	constructor(e, t, n) {
		super(`Value for "${e}" must be of type ${t}`, "INVALID_VALUE", n);
	}
}, nt = class extends $e {
	constructor(e, t) {
		super(`The intl string context variable "${e}" was not provided to the string "${t}"`, "MISSING_VALUE", t);
	}
};
function rt(e) {
	return e.length < 2 ? e : e.reduce((e, t) => {
		let n = e[e.length - 1];
		return !n || n.type !== 0 || t.type !== 0 ? e.push(t) : n.value += t.value, e;
	}, []);
}
function it(e) {
	return typeof e == "function";
}
function at(e, t, n, r, i, a, o) {
	if (e.length === 1 && ye(e[0])) return [{
		type: 0,
		value: e[0].value
	}];
	let s = [];
	for (let c of e) {
		if (ye(c)) {
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
		if (!(i && e in i)) throw new nt(e, o);
		let l = i[e];
		if (be(c)) {
			(!l || typeof l == "string" || typeof l == "number" || typeof l == "bigint") && (l = typeof l == "string" || typeof l == "number" || typeof l == "bigint" ? String(l) : ""), s.push({
				type: typeof l == "string" ? 0 : 1,
				value: l
			});
			continue;
		}
		if (Se(c)) {
			let e = typeof c.style == "string" ? r.date[c.style] : De(c.style) ? c.style.parsedOptions : void 0;
			s.push({
				type: 0,
				value: n.getDateTimeFormat(t, e).format(l)
			});
			continue;
		}
		if (O(c)) {
			let e = typeof c.style == "string" ? r.time[c.style] : De(c.style) ? c.style.parsedOptions : r.time.medium;
			s.push({
				type: 0,
				value: n.getDateTimeFormat(t, e).format(l)
			});
			continue;
		}
		if (xe(c)) {
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
			if (!it(u)) throw new tt(l, "function", o);
			let d = u(at(e, t, n, r, i, a).map((e) => e.value));
			Array.isArray(d) || (d = [d]), s.push(...d.map((e) => ({
				type: typeof e == "string" ? 0 : 1,
				value: e
			})));
		}
		if (k(c)) {
			let e = l, a = (Object.prototype.hasOwnProperty.call(c.options, e) ? c.options[e] : void 0) || c.options.other;
			if (!a) throw new et(c.value, l, Object.keys(c.options), o);
			s.push(...at(a.value, t, n, r, i));
			continue;
		}
		if (Ce(c)) {
			let e = `=${l}`, a = Object.prototype.hasOwnProperty.call(c.options, e) ? c.options[e] : void 0;
			if (!a) {
				if (!Intl.PluralRules) throw new $e("Intl.PluralRules is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-pluralrules\"\n", "MISSING_INTL_API", o);
				let e = typeof l == "bigint" ? Number(l) : l, r = n.getPluralRules(t, { type: c.pluralType }).select(e - (c.offset || 0));
				a = (Object.prototype.hasOwnProperty.call(c.options, r) ? c.options[r] : void 0) || c.options.other;
			}
			if (!a) throw new et(c.value, l, Object.keys(c.options), o);
			let u = typeof l == "bigint" ? Number(l) : l;
			s.push(...at(a.value, t, n, r, i, u - (c.offset || 0)));
			continue;
		}
	}
	return rt(s);
}
function ot(e, t) {
	return t ? {
		...e,
		...t,
		...Object.keys(e).reduce((n, r) => (n[r] = {
			...e[r],
			...t[r]
		}, n), {})
	} : e;
}
function st(e, t) {
	return t ? Object.keys(e).reduce((n, r) => (n[r] = ot(e[r], t[r]), n), { ...e }) : e;
}
function ct(e) {
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
function lt(e = {
	number: {},
	dateTime: {},
	pluralRules: {}
}) {
	return {
		getNumberFormat: y((...e) => new Intl.NumberFormat(...e), {
			cache: ct(e.number),
			strategy: D.variadic
		}),
		getDateTimeFormat: y((...e) => new Intl.DateTimeFormat(...e), {
			cache: ct(e.dateTime),
			strategy: D.variadic
		}),
		getPluralRules: y((...e) => new Intl.PluralRules(...e), {
			cache: ct(e.pluralRules),
			strategy: D.variadic
		})
	};
}
var ut = class e {
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
		}), this.formatToParts = ((e) => at(this.ast, this.locales, this.formatters, this.formats, e, void 0, this.message)), this.resolvedOptions = () => ({ locale: this.resolvedLocale?.toString() || Intl.NumberFormat.supportedLocalesOf(this.locales)[0] }), this.getAst = () => this.ast, this.locales = n, this.resolvedLocale = e.resolveLocale(n), typeof t == "string") {
			if (this.message = t, !e.__parse) throw TypeError("IntlMessageFormat.__parse must be set to process `message` of type `string`");
			let { ...n } = i || {};
			this.ast = e.__parse(t, {
				...n,
				locale: this.resolvedLocale
			});
		} else this.ast = t;
		if (!Array.isArray(this.ast)) throw TypeError("A message must be provided as a String or AST.");
		this.formats = st(e.formats, r), this.formatters = i && i.formatters || lt(this.formatterCache);
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
		this.__parse = Ze;
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
}, dt = class e extends Error {
	constructor(t, n, r) {
		let i = r ? r instanceof Error ? r : Error(String(r)) : void 0;
		super(`[@formatjs/intl Error ${t}] ${n}
${i ? `\n${i.message}\n${i.stack}` : ""}`), this.code = t, typeof Error.captureStackTrace == "function" && Error.captureStackTrace(this, e);
	}
}, ft = class extends dt {
	constructor(e, t) {
		super("UNSUPPORTED_FORMATTER", e, t);
	}
}, pt = class extends dt {
	constructor(e, t) {
		super("INVALID_CONFIG", e, t);
	}
}, mt = class extends dt {
	constructor(e, t) {
		super("MISSING_DATA", e, t);
	}
}, ht = class extends dt {
	constructor(e, t, n) {
		super("FORMAT_ERROR", `${e}
Locale: ${t}
`, n), this.locale = t;
	}
}, gt = class extends ht {
	constructor(e, t, n, r) {
		super(`${e}
MessageID: ${n?.id}
Default Message: ${n?.defaultMessage}
Description: ${n?.description}
`, t, r), this.descriptor = n, this.locale = t;
	}
}, _t = class extends dt {
	constructor(e, t) {
		super("MISSING_TRANSLATION", `Missing message: "${e.id}" for locale "${t}", using ${e.defaultMessage ? `default message (${typeof e.defaultMessage == "string" ? e.defaultMessage : e.defaultMessage.map((e) => e.value ?? JSON.stringify(e)).join()})` : "id"} as fallback.`), this.descriptor = e;
	}
};
function vt(e, t, n = Error) {
	if (!e) throw new n(t);
}
function yt(e, t, n = {}) {
	return t.reduce((t, r) => (r in e ? t[r] = e[r] : r in n && (t[r] = n[r]), t), {});
}
var bt = {
	formats: {},
	messages: {},
	timeZone: void 0,
	defaultLocale: "en",
	defaultFormats: {},
	fallbackOnEmptyString: !0,
	onError: (e) => {},
	onWarn: (e) => {}
};
function xt() {
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
function St(e) {
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
function Ct(e = xt()) {
	let t = Intl.RelativeTimeFormat, n = Intl.ListFormat, r = Intl.DisplayNames, i = y((...e) => new Intl.DateTimeFormat(...e), {
		cache: St(e.dateTime),
		strategy: D.variadic
	}), a = y((...e) => new Intl.NumberFormat(...e), {
		cache: St(e.number),
		strategy: D.variadic
	}), o = y((...e) => new Intl.PluralRules(...e), {
		cache: St(e.pluralRules),
		strategy: D.variadic
	});
	return {
		getDateTimeFormat: i,
		getNumberFormat: a,
		getMessageFormat: y((e, t, n, r) => new ut(e, t, n, {
			formatters: {
				getNumberFormat: a,
				getDateTimeFormat: i,
				getPluralRules: o
			},
			...r
		}), {
			cache: St(e.message),
			strategy: D.variadic
		}),
		getDurationFormat: y((...e) => new Intl.DurationFormat(...e), {
			cache: St(e.duration),
			strategy: D.variadic
		}),
		getRelativeTimeFormat: y((...e) => new t(...e), {
			cache: St(e.relativeTime),
			strategy: D.variadic
		}),
		getPluralRules: o,
		getListFormat: y((...e) => new n(...e), {
			cache: St(e.list),
			strategy: D.variadic
		}),
		getDisplayNames: y((...e) => new r(...e), {
			cache: St(e.displayNames),
			strategy: D.variadic
		})
	};
}
function wt(e, t, n, r) {
	let i = e && e[t], a;
	if (i && (a = i[n]), a) return a;
	r(new ft(`No ${t} format named: ${n}`));
}
function Tt(e, t) {
	return Object.keys(e).reduce((n, r) => (n[r] = {
		timeZone: t,
		...e[r]
	}, n), {});
}
function Et(e, t) {
	return Object.keys({
		...e,
		...t
	}).reduce((n, r) => (n[r] = {
		...e[r],
		...t[r]
	}, n), {});
}
function Dt(e, t) {
	if (!t) return e;
	let n = ut.formats;
	return {
		...n,
		...e,
		date: Et(Tt(n.date, t), Tt(e.date || {}, t)),
		time: Et(Tt(n.time, t), Tt(e.time || {}, t))
	};
}
function Ot(e) {
	let { defaultMessage: t } = e;
	try {
		return t === void 0 ? `\nMessage Descriptor: ${JSON.stringify(e)}` : `\nDefault Message: ${typeof t == "string" ? t : JSON.stringify(t)}`;
	} catch {
		return "";
	}
}
var kt = ({ locale: e, formats: t, messages: n, defaultLocale: r, defaultFormats: i, fallbackOnEmptyString: a, onError: o, timeZone: s, defaultRichTextElements: c }, l, u = { id: "" }, d, f) => {
	let { id: p, defaultMessage: m } = u;
	p || vt(!1, `[@formatjs/intl] An \`id\` must be provided to format a message. You can either:
1. Configure your build toolchain with [babel-plugin-formatjs](https://formatjs.github.io/docs/tooling/babel-plugin)
or [@formatjs/ts-transformer](https://formatjs.github.io/docs/tooling/ts-transformer) OR
2. Configure your \`eslint\` config to include [eslint-plugin-formatjs](https://formatjs.github.io/docs/tooling/linter#enforce-id)
to autofix this issue${Ot(u)}`);
	let h = String(p), g = n && Object.prototype.hasOwnProperty.call(n, h) && n[h];
	if (Array.isArray(g) && g.length === 1 && g[0].type === ve.literal) return g[0].value;
	if (d = {
		...c,
		...d
	}, t = Dt(t, s), i = Dt(i, s), !g) {
		if (a === !1 && g === "") return g;
		if ((!m || e && e.toLowerCase() !== r.toLowerCase()) && o(new _t(u, e)), m) try {
			return l.getMessageFormat(m, r, i, f).format(d);
		} catch (t) {
			return o(new gt(`Error formatting default message for: "${h}", rendering default message verbatim`, e, u, t)), typeof m == "string" ? m : h;
		}
		return h;
	}
	try {
		return l.getMessageFormat(g, e, t, {
			formatters: l,
			...f
		}).format(d);
	} catch (t) {
		o(new gt(`Error formatting message: "${h}", using ${m ? "default message" : "id"} as fallback.`, e, u, t));
	}
	if (m) try {
		return l.getMessageFormat(m, r, i, f).format(d);
	} catch (t) {
		o(new gt(`Error formatting the default message for: "${h}", rendering message verbatim`, e, u, t));
	}
	return typeof g == "string" ? g : typeof m == "string" ? m : h;
}, At = [
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
function jt({ locale: e, formats: t, onError: n, timeZone: r }, i, a, o = {}) {
	let { format: s } = o, c = yt(o, At, {
		...r && { timeZone: r },
		...s && wt(t, i, s, n)
	});
	return i === "time" && !c.hour && !c.minute && !c.second && !c.timeStyle && !c.dateStyle && (c = {
		...c,
		hour: "numeric",
		minute: "numeric"
	}), a(e, c);
}
function Mt(e, t, n, r = {}) {
	let i = typeof n == "string" ? new Date(n || 0) : n;
	try {
		return jt(e, "date", t, r).format(i);
	} catch (t) {
		e.onError(new ht("Error formatting date.", e.locale, t));
	}
	return String(i);
}
function Nt(e, t, n, r = {}) {
	let i = typeof n == "string" ? new Date(n || 0) : n;
	try {
		return jt(e, "time", t, r).format(i);
	} catch (t) {
		e.onError(new ht("Error formatting time.", e.locale, t));
	}
	return String(i);
}
function Pt(e, t, n, r, i = {}) {
	let a = typeof n == "string" ? new Date(n || 0) : n, o = typeof r == "string" ? new Date(r || 0) : r;
	try {
		return jt(e, "dateTimeRange", t, i).formatRange(a, o);
	} catch (t) {
		e.onError(new ht("Error formatting date time range.", e.locale, t));
	}
	return String(a);
}
function Ft(e, t, n, r = {}) {
	let i = typeof n == "string" ? new Date(n || 0) : n;
	try {
		return jt(e, "date", t, r).formatToParts(i);
	} catch (t) {
		e.onError(new ht("Error formatting date.", e.locale, t));
	}
	return [];
}
function It(e, t, n, r = {}) {
	let i = typeof n == "string" ? new Date(n || 0) : n;
	try {
		return jt(e, "time", t, r).formatToParts(i);
	} catch (t) {
		e.onError(new ht("Error formatting time.", e.locale, t));
	}
	return [];
}
var Lt = [
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
function Rt({ locale: e, formats: t, onError: n }, r, i) {
	if (!Intl.DurationFormat) {
		n(new $e("Intl.DurationFormat is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-durationformat\"", Qe.MISSING_INTL_API));
		return;
	}
	let { format: a } = i;
	return r(e, yt(i, Lt, a && wt(t, "duration", a, n) || {}));
}
function zt(e, t, n, r = {}) {
	try {
		return Rt(e, t, r)?.format(n) ?? "";
	} catch (t) {
		e.onError(new ht("Error formatting duration.", e.locale, t));
	}
	return "";
}
function Bt(e, t, n, r = {}) {
	try {
		return Rt(e, t, r)?.formatToParts(n) ?? [];
	} catch (t) {
		e.onError(new ht("Error formatting duration.", e.locale, t));
	}
	return [];
}
var Vt = [
	"style",
	"type",
	"fallback",
	"languageDisplay"
];
function Ht({ locale: e, onError: t }, n, r, i) {
	Intl.DisplayNames || t(new $e("Intl.DisplayNames is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-displaynames\"\n", Qe.MISSING_INTL_API));
	let a = yt(i, Vt);
	try {
		return n(e, a).of(r);
	} catch (n) {
		t(new ht("Error formatting display name.", e, n));
	}
}
var Ut = ["type", "style"], Wt = Date.now();
function Gt(e) {
	return `${Wt}_${e}_${Wt}`;
}
function Kt(e, t, n, r = {}) {
	let i = qt(e, t, n, r).reduce((e, t) => {
		let n = t.value;
		return typeof n == "string" && typeof e[e.length - 1] == "string" ? e[e.length - 1] += n : e.push(n), e;
	}, []);
	return i.length === 1 ? i[0] : i.length === 0 ? "" : i;
}
function qt({ locale: e, onError: t }, n, r, i = {}) {
	Intl.ListFormat || t(new $e("Intl.ListFormat is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-listformat\"\n", Qe.MISSING_INTL_API));
	let a = yt(i, Ut);
	try {
		let t = {}, i = Array.from(r).map((e, n) => {
			if (typeof e == "object" && e) {
				let r = Gt(n);
				return t[r] = e, r;
			}
			return String(e);
		});
		return n(e, a).formatToParts(i).map((e) => e.type === "literal" ? e : {
			...e,
			value: t[e.value] || e.value
		});
	} catch (n) {
		t(new ht("Error formatting list.", e, n));
	}
	return r;
}
var Jt = ["type"];
function Yt({ locale: e, onError: t }, n, r, i = {}) {
	Intl.PluralRules || t(new $e("Intl.PluralRules is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-pluralrules\"\n", Qe.MISSING_INTL_API));
	let a = yt(i, Jt);
	try {
		return n(e, a).select(r);
	} catch (n) {
		t(new ht("Error formatting plural.", e, n));
	}
	return "other";
}
var Xt = ["numeric", "style"];
function Zt({ locale: e, formats: t, onError: n }, r, i = {}) {
	let { format: a } = i;
	return r(e, yt(i, Xt, !!a && wt(t, "relative", a, n) || {}));
}
function Qt(e, t, n, r, i = {}) {
	r ||= "second", Intl.RelativeTimeFormat || e.onError(new $e("Intl.RelativeTimeFormat is not available in this environment.\nTry polyfilling it using \"@formatjs/intl-relativetimeformat\"\n", Qe.MISSING_INTL_API));
	try {
		return Zt(e, t, i).format(n, r);
	} catch (t) {
		e.onError(new ht("Error formatting relative time.", e.locale, t));
	}
	return String(n);
}
var $t = [
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
function en({ locale: e, formats: t, onError: n }, r, i = {}) {
	let { format: a } = i;
	return r(e, yt(i, $t, a && wt(t, "number", a, n) || {}));
}
function tn(e, t, n, r = {}) {
	try {
		return en(e, t, r).format(n);
	} catch (t) {
		e.onError(new ht("Error formatting number.", e.locale, t));
	}
	return String(n);
}
function nn(e, t, n, r = {}) {
	try {
		return en(e, t, r).formatToParts(n);
	} catch (t) {
		e.onError(new ht("Error formatting number.", e.locale, t));
	}
	return [];
}
function rn(e) {
	return typeof (e ? e[Object.keys(e)[0]] : void 0) == "string";
}
function an(e) {
	e.onWarn && e.defaultRichTextElements && rn(e.messages || {}) && e.onWarn("[@formatjs/intl] \"defaultRichTextElements\" was specified but \"message\" was not pre-compiled. \nPlease consider using \"@formatjs/cli\" to pre-compile your messages for performance.\nFor more details see https://formatjs.github.io/docs/getting-started/message-distribution");
}
function on(e, t) {
	let n = Ct(t), r = {
		...bt,
		...e
	}, { locale: i, defaultLocale: a, onError: o } = r;
	return i ? !Intl.NumberFormat.supportedLocalesOf(i).length && o ? o(new mt(`Missing locale data for locale: "${i}" in Intl.NumberFormat. Using default locale: "${a}" as fallback. See https://formatjs.github.io/docs/react-intl#runtime-requirements for more details`)) : !Intl.DateTimeFormat.supportedLocalesOf(i).length && o && o(new mt(`Missing locale data for locale: "${i}" in Intl.DateTimeFormat. Using default locale: "${a}" as fallback. See https://formatjs.github.io/docs/react-intl#runtime-requirements for more details`)) : (o && o(new pt(`"locale" was not configured, using "${a}" as fallback. See https://formatjs.github.io/docs/react-intl/api#intlshape for more details`)), r.locale = r.defaultLocale || "en"), an(r), {
		...r,
		formatters: n,
		formatNumber: tn.bind(null, r, n.getNumberFormat),
		formatNumberToParts: nn.bind(null, r, n.getNumberFormat),
		formatDuration: zt.bind(null, r, n.getDurationFormat),
		formatDurationToParts: Bt.bind(null, r, n.getDurationFormat),
		formatRelativeTime: Qt.bind(null, r, n.getRelativeTimeFormat),
		formatDate: Mt.bind(null, r, n.getDateTimeFormat),
		formatDateToParts: Ft.bind(null, r, n.getDateTimeFormat),
		formatTime: Nt.bind(null, r, n.getDateTimeFormat),
		formatDateTimeRange: Pt.bind(null, r, n.getDateTimeFormat),
		formatTimeToParts: It.bind(null, r, n.getDateTimeFormat),
		formatPlural: Yt.bind(null, r, n.getPluralRules),
		formatMessage: kt.bind(null, r, n),
		$t: kt.bind(null, r, n),
		formatList: Kt.bind(null, r, n.getListFormat),
		formatListToParts: qt.bind(null, r, n.getListFormat),
		formatDisplayName: Ht.bind(null, r, n.getDisplayNames)
	};
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react/cjs/react-jsx-runtime.production.js
var sn = /* @__PURE__ */ o(((e) => {
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
})), j = (/* @__PURE__ */ o(((e, t) => {
	t.exports = sn();
})))();
function cn(e, t, n = Error) {
	if (!e) throw new n(t);
}
function ln(e) {
	cn(e, "[React Intl] Could not find required `intl` object. <IntlProvider> needs to exist in the component ancestry.");
}
var un = {
	...bt,
	textComponent: _.Fragment
}, dn = (e) => _.Children.toArray(e).map((e, t) => _.isValidElement(e) ? /* @__PURE__ */ (0, j.jsx)(_.Fragment, { children: e }, t) : e);
function fn(e) {
	return function(t) {
		return e(dn(t));
	};
}
function pn(e, t) {
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
var mn = _.createContext(null), hn = mn.Provider;
function gn() {
	let e = _.useContext(mn);
	return ln(e), e;
}
var _n = /* @__PURE__ */ function(e) {
	return e.formatDate = "FormattedDate", e.formatTime = "FormattedTime", e.formatNumber = "FormattedNumber", e.formatList = "FormattedList", e.formatDuration = "FormattedDuration", e.formatDisplayName = "FormattedDisplayName", e;
}(_n || {}), vn = /* @__PURE__ */ function(e) {
	return e.formatDate = "FormattedDateParts", e.formatTime = "FormattedTimeParts", e.formatNumber = "FormattedNumberParts", e.formatList = "FormattedListParts", e;
}(vn || {});
function yn(e) {
	let t = (t) => {
		let n = gn(), { value: r, children: i, ...a } = t, o = typeof r == "string" ? new Date(r || 0) : r;
		return i(e === "formatDate" ? n.formatDateToParts(o, a) : n.formatTimeToParts(o, a));
	};
	return t.displayName = vn[e], t;
}
function bn(e) {
	let t = (t) => {
		let n = gn(), { value: r, children: i, ...a } = t, o = n[e](r, a);
		if (typeof i == "function") return i(o);
		let s = n.textComponent || _.Fragment;
		return /* @__PURE__ */ (0, j.jsx)(s, { children: o });
	};
	return t.displayName = _n[e], t;
}
function xn(e) {
	return e && Object.keys(e).reduce((t, n) => {
		let r = e[n];
		return t[n] = it(r) ? fn(r) : r, t;
	}, {});
}
var Sn = (e, t, n, r, ...i) => {
	let a = kt(e, t, n, xn(r), ...i);
	return Array.isArray(a) ? dn(a) : a;
}, Cn = ({ defaultRichTextElements: e, ...t }, n) => {
	let r = xn(e), i = on({
		...un,
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
		formatMessage: Sn.bind(null, a, i.formatters),
		$t: Sn.bind(null, a, i.formatters)
	};
};
function wn(e, t) {
	let { values: n, ...r } = e, { values: i, ...a } = t;
	return pn(i, n) && pn(r, a);
}
function Tn(e) {
	let { formatMessage: t, textComponent: n = _.Fragment } = gn(), { id: r, description: i, defaultMessage: a, values: o, children: s, tagName: c = n, ignoreTag: l } = e, u = t({
		id: r,
		description: i,
		defaultMessage: a
	}, o, { ignoreTag: l });
	return typeof s == "function" ? s(Array.isArray(u) ? u : [u]) : c ? /* @__PURE__ */ (0, j.jsx)(c, { children: u }) : /* @__PURE__ */ (0, j.jsx)(j.Fragment, { children: u });
}
Tn.displayName = "FormattedMessage";
var En = _.memo(Tn, wn);
En.displayName = "MemoizedFormattedMessage";
function Dn(e) {
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
function On(e) {
	let t = _.useRef(xt()), n = _.useRef(void 0), r = _.useRef(void 0), i = {};
	for (let t in e) e[t] !== void 0 && (i[t] = e[t]);
	let a = Dn({
		...un,
		...i
	});
	return (!n.current || !pn(n.current, a)) && (n.current = a, r.current = Cn(a, t.current)), ln(r.current), /* @__PURE__ */ (0, j.jsx)(hn, {
		value: r.current,
		children: e.children
	});
}
On.displayName = "IntlProvider";
var kn = On;
bn("formatDate"), bn("formatTime"), bn("formatNumber"), bn("formatDuration"), bn("formatList"), bn("formatDisplayName"), yn("formatDate"), yn("formatTime");
//#endregion
//#region app/ui/src/text/en.json
var An = {
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
	"ASK.answer.figure.open": "{label}: {display}. {exact} Opens calculation receipt {receipt}."
}, jn = {
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
	"ASK.answer.figure.open": "{label}: {display}। {exact} गणना की रसीद {receipt} खोलता है।"
}, Mn = {
	en: An,
	hi: jn
}, Nn = (0, _.createContext)("en");
function Pn({ language: e, children: t }) {
	return /* @__PURE__ */ (0, j.jsx)(Nn.Provider, {
		value: e,
		children: /* @__PURE__ */ (0, j.jsx)(kn, {
			locale: e,
			messages: Mn[e],
			defaultLocale: "en",
			children: t
		})
	});
}
function Fn() {
	return (0, _.useContext)(Nn);
}
function M() {
	let e = gn();
	return (t, n) => e.formatMessage({ id: t }, n);
}
//#endregion
//#region app/ui/src/app/routes.ts
var In = [
	"today",
	"ask",
	"work",
	"books",
	"reports",
	"tools",
	"trust"
], Ln = /* @__PURE__ */ new Set([
	...In,
	"company",
	"clients",
	"more"
]);
function Rn(e) {
	return Ln.has(e);
}
var zn = /^[a-z][a-z0-9-]{0,63}$/, Bn = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/;
function Vn(e) {
	let t = (e.startsWith("#") ? e.slice(1) : e).split("?"), n = t[0], r = t[1], i = (n ?? "").split("/").map((e) => e.trim()).filter((e) => e.length > 0), a = i[0] ?? "today";
	if (!Rn(a)) return { place: "today" };
	let o = a, s = i[1], c = s !== void 0 && zn.test(s) ? s : void 0, l;
	if (n === `/${o}${c === void 0 ? "" : `/${c}`}` && t.length === 2 && r?.startsWith("sheet=")) {
		let e = r.slice(6);
		Bn.exec(e)?.[0] === e && (l = e);
	}
	let u = { place: o };
	return c !== void 0 && (u.sub = c), l !== void 0 && (u.sheet = l), u;
}
function Hn(e) {
	let t = `#/${e.place}`;
	return e.sub && (t += `/${e.sub}`), e.sheet && (t += `?sheet=${e.sheet}`), t;
}
function Un(e, t) {
	return e.place === t.place && e.sub === t.sub && e.sheet === t.sheet;
}
function Wn(e) {
	let t = { place: e.place };
	return e.sub !== void 0 && (t.sub = e.sub), t;
}
function Gn(e, t) {
	return {
		...Wn(e),
		sheet: t
	};
}
//#endregion
//#region app/ui/src/app/places.ts
var N = (e, t) => ({
	id: t,
	nameKey: `SH-01.sub.${e}.${t}`
}), Kn = {
	today: [N("today", "today"), N("today", "activity")],
	ask: [
		N("ask", "new"),
		N("ask", "saved"),
		N("ask", "decisions"),
		N("ask", "checks"),
		N("ask", "notyet")
	],
	work: [
		N("work", "approvals"),
		N("work", "jobs"),
		N("work", "actions"),
		N("work", "cando")
	],
	books: [
		N("books", "sources"),
		N("books", "meanings"),
		N("books", "accounts"),
		N("books", "customers"),
		N("books", "history"),
		N("books", "memory")
	],
	reports: [
		N("reports", "packs"),
		N("reports", "weekahead"),
		N("reports", "duedates"),
		N("reports", "exports")
	],
	tools: [
		N("tools", "smallapps"),
		N("tools", "plugins"),
		N("tools", "assistants"),
		N("tools", "phone")
	],
	trust: [
		N("trust", "rules"),
		N("trust", "people"),
		N("trust", "models"),
		N("trust", "network"),
		N("trust", "record"),
		N("trust", "sharing"),
		N("trust", "vault")
	]
}, qn = {
	today: Kn.today,
	ask: [...Kn.ask, N("ask", "plans")],
	work: [
		...Kn.work,
		N("work", "cases"),
		N("work", "agents")
	],
	books: [
		N("books", "sources"),
		N("books", "meanings"),
		N("books", "accounts"),
		N("books", "records"),
		N("books", "history"),
		N("books", "memory"),
		N("books", "issues"),
		N("books", "companies")
	],
	reports: [
		N("reports", "packs"),
		N("reports", "briefs"),
		N("reports", "duedates"),
		N("reports", "exports"),
		N("reports", "sent")
	],
	tools: [
		N("tools", "smallapps"),
		N("tools", "plugins"),
		N("tools", "assistants"),
		N("tools", "planning")
	],
	trust: [
		...Kn.trust,
		N("trust", "access"),
		N("trust", "markings"),
		N("trust", "retention"),
		N("trust", "channels")
	],
	company: [
		N("company", "signin"),
		N("company", "health"),
		N("company", "recovery"),
		N("company", "keys"),
		N("company", "support"),
		N("company", "computers"),
		N("company", "quality"),
		N("company", "build"),
		N("company", "licence")
	]
}, Jn = (e, t) => ({
	id: e,
	nameKey: `SH-01.place.${e}`,
	subs: t
}), Yn = [
	Jn("today", []),
	Jn("clients", []),
	Jn("work", [
		N("work", "cosign"),
		N("work", "many"),
		N("work", "questions")
	]),
	Jn("reports", [N("reports", "handover")]),
	Jn("tools", [N("tools", "library"), N("tools", "invite")]),
	Jn("trust", [N("trust", "people"), N("trust", "firmname")])
];
function Xn(e) {
	return e.kind === "enterprise" ? e.allowed : void 0;
}
function Zn(e, t, n) {
	let r = Xn(e);
	return $n(e, t).some((e) => e.id === n) && (r === void 0 || r.has(`${t}.${n}`));
}
function Qn(e) {
	if (e === "company") return qn.company;
	let t = In.find((t) => t === e);
	return t === void 0 ? [] : qn[t];
}
function $n(e, t) {
	if (e.kind === "enterprise") return Qn(t);
	if (e.kind === "ca-firm") return Yn.find((e) => e.id === t)?.subs ?? [];
	let n = In.find((e) => e === t);
	return n === void 0 ? [] : Kn[n];
}
function er(e, t) {
	let n = Xn(e);
	return n === void 0 || Qn(t).some((e) => n.has(`${t}.${e.id}`));
}
function tr(e, t) {
	return Xn(e) === void 0 ? t : {
		...t,
		subs: t.subs.filter((n) => Zn(e, t.id, n.id))
	};
}
function nr(e) {
	return e.kind === "ca-firm" ? Yn : e.kind === "enterprise" ? [...In, "company"].filter((t) => sr(e, t)).map((t) => tr(e, Jn(t, qn[t]))) : e.view === "simple" ? [
		Jn("today", Kn.today),
		Jn("ask", Kn.ask),
		Jn("work", Kn.work),
		Jn("more", [])
	] : In.map((e) => Jn(e, Kn[e]));
}
function rr() {
	return [
		Jn("books", Kn.books),
		Jn("reports", Kn.reports),
		Jn("tools", Kn.tools),
		Jn("trust", Kn.trust)
	];
}
function ir(e, t) {
	return e.kind === "desktop" && e.view === "simple" && rr().some((e) => e.id === t) ? "more" : t;
}
function ar(e, t) {
	return sr(e, t) && (t === "today" || e.kind === "ca-firm" && t === "clients");
}
function or(e) {
	return e.kind === "ca-firm" ? [
		"today",
		"clients",
		"work",
		"reports",
		"tools",
		"trust"
	] : In;
}
function sr(e, t) {
	return t === "more" ? e.kind === "desktop" && e.view === "simple" : t === "company" ? e.kind === "enterprise" && e.administers === !0 && er(e, t) : t === "clients" ? e.kind === "ca-firm" : e.kind === "ca-firm" ? t !== "ask" && t !== "books" : er(e, t);
}
function cr(e, t) {
	if (t !== void 0 && Xn(e) === void 0) return sr(e, t) ? { place: t } : null;
	let n = nr(e), r = t === void 0 ? n[0] : n.find((e) => e.id === t);
	if (r === void 0) return null;
	let i = r.subs[0];
	return Xn(e) === void 0 ? { place: r.id } : i === void 0 ? null : {
		place: r.id,
		sub: i.id
	};
}
function lr(e, t) {
	return sr(e, t.place) ? t.sub !== void 0 && !Zn(e, t.place, t.sub) || t.sub === void 0 && Xn(e) !== void 0 ? cr(e, t.place) : t : cr(e);
}
//#endregion
//#region app/ui/src/app/composition.ts
function ur(e, t) {
	if (e !== null && e.sheet !== void 0 && t !== void 0) return Un(e, t.address) ? t.content : void 0;
}
function dr(e) {
	return e.kind === "locked" || e.kind === "boundary-state" && e.source.kind === "locked";
}
function fr(e, t) {
	t !== null && (e.preventDefault(), !t.money && !t.disabled && t.onPress());
}
//#endregion
//#region app/ui/src/app/keys.ts
function pr(e) {
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
var mr = [
	"rail",
	"page",
	"sheet",
	"ask"
];
function hr(e, t, n) {
	let r = mr.filter((e) => t.has(e));
	if (r.length === 0) return null;
	let i = e ? r.indexOf(e) : -1;
	return i === -1 ? (n ? r[r.length - 1] : r[0]) ?? null : r[(i + (n ? -1 : 1) + r.length) % r.length] ?? null;
}
var gr = {
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
function _r() {
	let e = M();
	return /* @__PURE__ */ (0, j.jsxs)("span", {
		className: gr.wordmark,
		children: [/* @__PURE__ */ (0, j.jsxs)("svg", {
			className: gr.mark,
			viewBox: "0 0 20 20",
			"aria-hidden": "true",
			focusable: "false",
			children: [/* @__PURE__ */ (0, j.jsx)("rect", {
				x: "1",
				y: "1",
				width: "9",
				height: "9",
				rx: "1.5",
				className: gr.m1
			}), /* @__PURE__ */ (0, j.jsx)("rect", {
				x: "10",
				y: "10",
				width: "9",
				height: "9",
				rx: "1.5",
				className: gr.m2
			})]
		}), /* @__PURE__ */ (0, j.jsx)("span", {
			className: gr.word,
			children: e("SH-01.wordmark")
		})]
	});
}
function vr({ shell: e, address: t, onNavigate: n, counts: r, foot: i, narrow: a }) {
	let o = M(), s = nr(e), c = (0, _.useId)(), l = ir(e, t.place), u = (e, t) => {
		let r = { place: e };
		t !== void 0 && (r.sub = t), n(r);
	}, d = (t) => ar(e, t) ? r?.[t] : void 0, f = /* @__PURE__ */ (0, j.jsx)("ul", {
		className: gr.places,
		children: s.map((e) => {
			let n = e.id === l, r = d(e.id), i = e.id === "more" ? rr() : [];
			return /* @__PURE__ */ (0, j.jsxs)("li", {
				className: gr.placeItem,
				children: [
					/* @__PURE__ */ (0, j.jsxs)("a", {
						href: Hn({ place: e.id }),
						className: [gr.place, n ? gr.here : ""].join(" "),
						"aria-current": n ? e.id === t.place ? "page" : "true" : void 0,
						onClick: (t) => {
							t.preventDefault(), u(e.id);
						},
						children: [/* @__PURE__ */ (0, j.jsx)("span", { children: o(e.nameKey) }), r && /* @__PURE__ */ (0, j.jsx)("span", {
							className: [gr.count, "fig"].join(" "),
							"aria-label": o("SH-01.count", { count: r.display }),
							children: r.display
						})]
					}),
					n && i.length > 0 && /* @__PURE__ */ (0, j.jsx)("ul", {
						className: gr.subs,
						children: i.map((e) => {
							let n = t.place === e.id;
							return /* @__PURE__ */ (0, j.jsx)("li", { children: /* @__PURE__ */ (0, j.jsx)("a", {
								href: Hn({ place: e.id }),
								className: [gr.sub, n ? gr.here : ""].join(" "),
								"aria-current": n ? "page" : void 0,
								onClick: (t) => {
									t.preventDefault(), u(e.id);
								},
								children: o(e.nameKey)
							}) }, e.id);
						})
					}),
					n && e.subs.length > 0 && /* @__PURE__ */ (0, j.jsx)("ul", {
						className: gr.subs,
						children: e.subs.map((n) => {
							let r = t.sub === n.id || t.sub === void 0 && n === e.subs[0];
							return /* @__PURE__ */ (0, j.jsx)("li", { children: /* @__PURE__ */ (0, j.jsx)("a", {
								href: Hn({
									place: e.id,
									sub: n.id
								}),
								className: [gr.sub, r ? gr.here : ""].join(" "),
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
		return /* @__PURE__ */ (0, j.jsxs)("nav", {
			className: gr.topbar,
			"aria-label": o("SH-01.rail.label"),
			"data-region": "rail",
			children: [/* @__PURE__ */ (0, j.jsx)(_r, {}), /* @__PURE__ */ (0, j.jsxs)("details", {
				className: gr.menu,
				children: [/* @__PURE__ */ (0, j.jsxs)("summary", {
					className: gr.summary,
					"aria-controls": c,
					"data-region-entry": "",
					children: [/* @__PURE__ */ (0, j.jsx)("span", { children: o(`SH-01.place.${t.place}`) }), e && /* @__PURE__ */ (0, j.jsx)("span", {
						className: [gr.count, "fig"].join(" "),
						"aria-label": o("SH-01.count", { count: e.display }),
						children: e.display
					})]
				}), /* @__PURE__ */ (0, j.jsxs)("div", {
					id: c,
					className: gr.menuBody,
					children: [f, /* @__PURE__ */ (0, j.jsx)("div", {
						className: gr.foot,
						children: i
					})]
				})]
			})]
		});
	}
	return /* @__PURE__ */ (0, j.jsxs)("nav", {
		className: gr.rail,
		"aria-label": o("SH-01.rail.label"),
		"data-region": "rail",
		children: [
			/* @__PURE__ */ (0, j.jsx)("div", {
				className: gr.top,
				children: /* @__PURE__ */ (0, j.jsx)(_r, {})
			}),
			f,
			/* @__PURE__ */ (0, j.jsx)("div", {
				className: gr.foot,
				children: i
			})
		]
	});
}
var yr = {
	square: "_square_1buaq_1",
	cha: "_cha_1buaq_12",
	you: "_you_1buaq_14",
	wait: "_wait_1buaq_16",
	busy: "_busy_1buaq_18",
	unsure: "_unsure_1buaq_20",
	guess: "_guess_1buaq_22",
	off: "_off_1buaq_24",
	words: "_words_1buaq_26"
}, br = {
	cha: "MARK.cha",
	you: "MARK.you",
	wait: "MARK.wait",
	busy: "MARK.busy",
	unsure: "MARK.unsure",
	guess: "MARK.guess",
	off: "MARK.off"
};
function xr({ mark: e, wordsKey: t, showWords: n = !1, className: r }) {
	let i = M()(t ?? br[e]);
	return /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)("span", {
		className: [
			yr.square,
			yr[e],
			r
		].filter(Boolean).join(" "),
		"aria-hidden": "true"
	}), /* @__PURE__ */ (0, j.jsx)("span", {
		className: n ? yr.words : "sr",
		children: i
	})] });
}
var Sr = {
	button: "_button_4s53g_1",
	filled: "_filled_4s53g_19",
	quiet: "_quiet_4s53g_30",
	link: "_link_4s53g_35",
	danger: "_danger_4s53g_47"
};
//#endregion
//#region app/ui/src/parts/Button.tsx
function Cr({ variant: e = "quiet", danger: t = !1, submit: n = !1, className: r, children: i, ...a }) {
	let o = [
		Sr.button,
		Sr[e],
		t ? Sr.danger : "",
		"m-press",
		r
	].filter(Boolean).join(" ");
	return /* @__PURE__ */ (0, j.jsx)("button", {
		type: n ? "submit" : "button",
		className: o,
		...a,
		children: i
	});
}
//#endregion
//#region app/ui/src/app/ask-question.ts
function wr(e) {
	return e.trim().length === 0 ? null : e;
}
var Tr = {
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
function Er(e) {
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
var Dr = (0, _.forwardRef)(function({ onAsk: e, onChange: t, suggestions: n, onPick: r, about: i, voice: a, hold: o, simple: s = !1, noModel: c = !1, readOnly: l, placeholderKey: u = "SH-04.placeholder" }, d) {
	let f = M(), [p, m] = (0, _.useState)(""), h = (0, _.useId)(), g = (t) => {
		t.preventDefault();
		let n = wr(p);
		n !== null && (e(n), m(""));
	}, v = a ? a.on ? {
		onPointerDown: (e) => {
			e.button === 0 && (e.currentTarget.setPointerCapture(e.pointerId), o.start());
		},
		onPointerUp: o.end,
		onPointerCancel: o.end,
		onLostPointerCapture: o.end,
		onBlur: o.end
	} : { onClick: a.onOpenSettings } : {}, y = a ? s ? /* @__PURE__ */ (0, j.jsxs)(Cr, {
		variant: "quiet",
		className: Tr.hold,
		"aria-pressed": a.listening ? !0 : void 0,
		...v,
		children: [
			/* @__PURE__ */ (0, j.jsx)(Or, {}),
			" ",
			a.on ? f("SH-04.mic") : f("SH-04.mic.off.short")
		]
	}) : /* @__PURE__ */ (0, j.jsx)("button", {
		type: "button",
		className: Tr.mic,
		"aria-label": a.on ? f("SH-04.mic") : f("SH-04.mic.off"),
		"aria-pressed": a.listening ? !0 : void 0,
		title: a.costPerMinute === void 0 ? void 0 : f("SH-04.mic.cost", { cost: a.costPerMinute }),
		...v,
		children: /* @__PURE__ */ (0, j.jsx)(Or, {})
	}) : null;
	return /* @__PURE__ */ (0, j.jsxs)("form", {
		className: Tr.line,
		role: "search",
		"aria-label": f("SH-01.region.ask"),
		onSubmit: g,
		"data-region": "ask",
		children: [
			/* @__PURE__ */ (0, j.jsx)(xr, {
				mark: "you",
				wordsKey: "MARK.you"
			}),
			i && /* @__PURE__ */ (0, j.jsxs)("span", {
				className: Tr.about,
				children: [/* @__PURE__ */ (0, j.jsx)("span", { children: f("SH-04.about", { name: i.name }) }), /* @__PURE__ */ (0, j.jsx)(Cr, {
					variant: "link",
					onClick: i.onClear,
					className: Tr.aboutClear,
					children: f("SH-04.about.clear")
				})]
			}),
			/* @__PURE__ */ (0, j.jsx)("input", {
				ref: d,
				className: Tr.input,
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
			!s && /* @__PURE__ */ (0, j.jsx)("span", {
				className: [Tr.key, "fig"].join(" "),
				"aria-hidden": "true",
				children: f("SH-04.key")
			}),
			a?.listening && /* @__PURE__ */ (0, j.jsx)("span", {
				className: Tr.state,
				role: "status",
				children: f("SH-04.listening")
			}),
			c && /* @__PURE__ */ (0, j.jsx)("span", {
				className: Tr.state,
				role: "status",
				children: f("SH-04.noModel")
			}),
			l && /* @__PURE__ */ (0, j.jsx)("span", {
				className: Tr.state,
				children: f("SH-04.readOnly", { holder: l.holder })
			}),
			n && n.length > 0 && /* @__PURE__ */ (0, j.jsx)("ul", {
				id: h,
				className: Tr.suggestions,
				role: "listbox",
				children: n.slice(0, 5).map((e) => /* @__PURE__ */ (0, j.jsx)("li", {
					role: "option",
					"aria-selected": !1,
					children: r ? /* @__PURE__ */ (0, j.jsxs)("button", {
						type: "button",
						className: Tr.suggestion,
						onClick: () => r(e.id),
						children: [/* @__PURE__ */ (0, j.jsx)("span", { children: e.text }), /* @__PURE__ */ (0, j.jsx)("span", {
							className: Tr.kind,
							children: f(`SH-04.kind.${e.kind}`)
						})]
					}) : /* @__PURE__ */ (0, j.jsxs)("span", {
						className: Tr.suggestion,
						children: [/* @__PURE__ */ (0, j.jsx)("span", { children: e.text }), /* @__PURE__ */ (0, j.jsx)("span", {
							className: Tr.kind,
							children: f(`SH-04.kind.${e.kind}`)
						})]
					})
				}, e.id))
			})
		]
	});
});
function Or() {
	return /* @__PURE__ */ (0, j.jsxs)("svg", {
		className: Tr.glyph,
		viewBox: "0 0 16 16",
		"aria-hidden": "true",
		focusable: "false",
		children: [/* @__PURE__ */ (0, j.jsx)("rect", {
			x: "5.5",
			y: "1.5",
			width: "5",
			height: "8",
			rx: "2.5",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "1.2"
		}), /* @__PURE__ */ (0, j.jsx)("path", {
			d: "M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.5M5.5 14.5h5",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "1.2",
			strokeLinecap: "round"
		})]
	});
}
var kr = {
	line: "_line_1fry5_1",
	fact: "_fact_1fry5_12",
	simple: "_simple_1fry5_22"
};
//#endregion
//#region app/ui/src/app/StatusLine.tsx
function Ar({ status: e, view: t, onNavigate: n, simpleSentences: r }) {
	let i = M();
	if (t === "simple" && r) return /* @__PURE__ */ (0, j.jsxs)("p", {
		className: [kr.line, kr.simple].join(" "),
		role: "status",
		"aria-label": i("SH-01.region.status"),
		"data-region": "status",
		children: [/* @__PURE__ */ (0, j.jsx)("span", { children: r[0] }), /* @__PURE__ */ (0, j.jsx)("span", { children: r[1] })]
	});
	let a = [
		e.sources,
		e.model,
		e.third
	];
	return /* @__PURE__ */ (0, j.jsxs)("p", {
		className: [kr.line, "fig"].join(" "),
		role: "status",
		"aria-label": i("SH-01.region.status"),
		"data-region": "status",
		children: [a.map((e, t) => e.address ? /* @__PURE__ */ (0, j.jsx)("a", {
			className: kr.fact,
			href: Hn(e.address),
			onClick: (t) => {
				t.preventDefault(), e.address && n(e.address);
			},
			children: e.text
		}, t) : /* @__PURE__ */ (0, j.jsx)("span", {
			className: kr.fact,
			children: e.text
		}, t)), t === "books" && /* @__PURE__ */ (0, j.jsx)("span", {
			className: kr.fact,
			children: i("SH-01.status.keys")
		})]
	});
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/chain.mjs
function jr(...e) {
	return (...t) => {
		for (let n of e) typeof n == "function" && n(...t);
	};
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useLayoutEffect.mjs
var P = typeof document < "u" ? _.useLayoutEffect : () => {}, Mr = {
	prefix: String(Math.round(Math.random() * 1e10)),
	current: 0
}, Nr = /*#__PURE__*/ _.createContext(Mr), Pr = /*#__PURE__*/ _.createContext(!1);
typeof window < "u" && window.document && window.document.createElement;
var Fr = /* @__PURE__ */ new WeakMap();
function Ir(e = !1) {
	let t = (0, _.useContext)(Nr), n = (0, _.useRef)(null);
	if (n.current === null && !e) {
		let e = _.default.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED?.ReactCurrentOwner?.current;
		if (e) {
			let n = Fr.get(e);
			n == null ? Fr.set(e, {
				id: t.current,
				state: e.memoizedState
			}) : e.memoizedState !== n.state && (t.current = n.id, Fr.delete(e));
		}
		n.current = ++t.current;
	}
	return n.current;
}
function Lr(e) {
	let t = (0, _.useContext)(Nr), n = Ir(!!e), r = `react-aria${t.prefix}`;
	return e || `${r}-${n}`;
}
function Rr(e) {
	let t = _.useId(), [n] = (0, _.useState)(Ur()), r = n ? "react-aria" : `react-aria${Mr.prefix}`;
	return e || `${r}-${t}`;
}
var zr = typeof _.useId == "function" ? Rr : Lr;
function Br() {
	return !1;
}
function Vr() {
	return !0;
}
function Hr(e) {
	return () => {};
}
function Ur() {
	return typeof _.useSyncExternalStore == "function" ? _.useSyncExternalStore(Hr, Br, Vr) : (0, _.useContext)(Pr);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useValueEffect.mjs
function Wr(e) {
	let [t, n] = (0, _.useState)(e), r = (0, _.useRef)(t), i = (0, _.useRef)(null), a = (0, _.useRef)(() => {
		if (!i.current) return;
		let e = i.current.next();
		if (e.done) {
			i.current = null;
			return;
		}
		r.current === e.value ? a.current() : n(e.value);
	});
	return P(() => {
		r.current = t, i.current && a.current();
	}), [t, (0, _.useCallback)((e) => {
		i.current = e(r.current), a.current();
	}, [a])];
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useId.mjs
var Gr = !!(typeof window < "u" && window.document && window.document.createElement), Kr = /* @__PURE__ */ new Map(), qr;
typeof FinalizationRegistry < "u" && (qr = new FinalizationRegistry((e) => {
	Kr.delete(e);
}));
var Jr = /* @__PURE__ */ new WeakMap();
function Yr(e) {
	let [t, n] = (0, _.useState)(e), r = (0, _.useRef)(null), i = zr(t), a = (0, _.useRef)(null), o = Jr.get(a);
	if (qr && o !== i && (o != null && qr.unregister(a), qr.register(a, i, a), Jr.set(a, i)), Gr) {
		let e = Kr.get(i);
		e && !e.includes(r) ? e.push(r) : Kr.set(i, [r]);
	}
	return P(() => {
		let e = i;
		return () => {
			qr && (qr.unregister(a), Jr.delete(a)), Kr.delete(e);
		};
	}, [i]), (0, _.useEffect)(() => {
		let e = r.current;
		return e && n(e), () => {
			e && (r.current = null);
		};
	}), i;
}
function Xr(e, t) {
	if (e === t) return e;
	let n = Kr.get(e);
	if (n) return n.forEach((e) => e.current = t), t;
	let r = Kr.get(t);
	return r ? (r.forEach((t) => t.current = e), e) : t;
}
function Zr(e = []) {
	let t = Yr(), [n, r] = Wr(t), i = (0, _.useCallback)(() => {
		r(function* () {
			yield t, yield document.getElementById(t) ? t : void 0;
		});
	}, [t, r]);
	return P(i, [
		t,
		i,
		...e
	]), n;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/mergeRefs.mjs
function Qr(...e) {
	return e.length === 1 && e[0] ? e[0] : (t) => {
		let n = !1, r = e.map((e) => {
			let r = $r(e, t);
			return n ||= typeof r == "function", r;
		});
		if (n) return () => {
			r.forEach((t, n) => {
				typeof t == "function" ? t() : $r(e[n], null);
			});
		};
	};
}
function $r(e, t) {
	if (typeof e == "function") return e(t);
	e != null && (e.current = t);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/clsx/dist/clsx.mjs
function ei(e) {
	var t, n, r = "";
	if (typeof e == "string" || typeof e == "number") r += e;
	else if (typeof e == "object") {
		if (Array.isArray(e)) {
			var i = e.length;
			for (t = 0; t < i; t++) e[t] && (n = ei(e[t])) && (r && (r += " "), r += n);
		} else for (n in e) e[n] && (r && (r += " "), r += n);
	}
	return r;
}
function ti() {
	for (var e, t, n = 0, r = "", i = arguments.length; n < i; n++) (e = arguments[n]) && (t = ei(e)) && (r && (r += " "), r += t);
	return r;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/mergeProps.mjs
function ni(...e) {
	let t = { ...e[0] };
	for (let n = 1; n < e.length; n++) {
		let r = e[n];
		for (let e in r) {
			let n = t[e], i = r[e];
			typeof n == "function" && typeof i == "function" && e[0] === "o" && e[1] === "n" && e.charCodeAt(2) >= 65 && e.charCodeAt(2) <= 90 ? t[e] = jr(n, i) : (e === "className" || e === "UNSAFE_className") && typeof n == "string" && typeof i == "string" ? t[e] = ti(n, i) : e === "id" && n && i ? t.id = Xr(n, i) : e === "ref" && n && i ? t.ref = Qr(n, i) : t[e] = i === void 0 ? n : i;
		}
	}
	return t;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useObjectRef.mjs
function ri(e) {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria-components/dist/private/utils.mjs
var ii = Symbol("default");
function ai({ values: e, children: t }) {
	for (let [n, r] of e) t = /*#__PURE__*/ _.createElement(n.Provider, { value: r }, t);
	return t;
}
function oi(e) {
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
function si(e, t) {
	let n = (0, _.useContext)(e);
	if (t === null) return null;
	if (n && typeof n == "object" && "slots" in n && n.slots) {
		let e = t || ii;
		if (!n.slots[e]) {
			let e = new Intl.ListFormat().format(Object.keys(n.slots).map((e) => `"${e}"`)), r = t ? `Invalid slot "${t}".` : "A slot prop is required.";
			throw Error(`${r} Valid slot names are ${e}.`);
		}
		return n.slots[e];
	}
	return n;
}
function ci(e, t, n) {
	let { ref: r, ...i } = si(n, e.slot) || {}, a = ri((0, _.useMemo)(() => Qr(t, r), [t, r])), o = ni(i, e);
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
function li(e = !0) {
	let [t, n] = (0, _.useState)(e), r = (0, _.useRef)(!1), i = (0, _.useCallback)((e) => {
		r.current = !0, n(!!e);
	}, []);
	return P(() => {
		r.current || n(!1);
	}, []), [i, t];
}
function ui(e, t, n) {
	let { render: r, ...i } = t, a = (0, _.useRef)(null), o = (0, _.useMemo)(() => Qr(n, a), [n, a]);
	P(() => {}, [e, r]);
	let s = {
		...i,
		ref: o
	};
	return r ? r(s, void 0) : /*#__PURE__*/ _.createElement(e, s);
}
var di = {}, fi = new Proxy({}, { get(e, t) {
	if (typeof t != "string") return;
	let n = di[t];
	return n || (n = /*#__PURE__*/ (0, _.forwardRef)(ui.bind(null, t)), di[t] = n), n;
} });
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/collections/Hidden.mjs
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
var pi = /*#__PURE__*/ (0, _.createContext)(!1);
function mi(e) {
	if ((0, _.useContext)(pi)) return /*#__PURE__*/ _.createElement(_.Fragment, null, e.children);
	let t = /*#__PURE__*/ _.createElement(pi.Provider, { value: !0 }, e.children);
	return /*#__PURE__*/ _.createElement("template", null, t);
}
function hi(e) {
	let t = (t, n) => (0, _.useContext)(pi) ? null : e(t, n);
	return t.displayName = e.displayName || e.name, (0, _.forwardRef)(t);
}
function gi() {
	return (0, _.useContext)(pi);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/filterDOMProps.mjs
var _i = /* @__PURE__ */ new Set(["id"]), vi = /* @__PURE__ */ new Set([
	"aria-label",
	"aria-labelledby",
	"aria-describedby",
	"aria-details"
]), yi = /* @__PURE__ */ new Set([
	"href",
	"hrefLang",
	"target",
	"rel",
	"download",
	"ping",
	"referrerPolicy"
]), bi = /* @__PURE__ */ new Set([
	"dir",
	"lang",
	"hidden",
	"inert",
	"translate"
]), xi = /* @__PURE__ */ new Set(/* @__PURE__ */ "onClick.onAuxClick.onContextMenu.onDoubleClick.onMouseDown.onMouseEnter.onMouseLeave.onMouseMove.onMouseOut.onMouseOver.onMouseUp.onTouchCancel.onTouchEnd.onTouchMove.onTouchStart.onPointerDown.onPointerMove.onPointerUp.onPointerCancel.onPointerEnter.onPointerLeave.onPointerOver.onPointerOut.onGotPointerCapture.onLostPointerCapture.onScroll.onWheel.onAnimationStart.onAnimationEnd.onAnimationIteration.onTransitionCancel.onTransitionEnd.onTransitionRun.onTransitionStart".split(".")), Si = /^(data-.*)$/;
function Ci(e, t = {}) {
	let { labelable: n, isLink: r, global: i, events: a = i, propNames: o } = t, s = {};
	for (let t in e) Object.prototype.hasOwnProperty.call(e, t) && (_i.has(t) || n && vi.has(t) || r && yi.has(t) || i && bi.has(t) || a && (xi.has(t) || t.endsWith("Capture") && xi.has(t.slice(0, -7))) || o?.has(t) || Si.test(t)) && (s[t] = e[t]);
	return s;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useLabels.mjs
function wi(e, t) {
	let { id: n, "aria-label": r, "aria-labelledby": i } = e;
	return n = Yr(n), i && r ? i = [.../* @__PURE__ */ new Set([n, ...i.trim().split(/\s+/)])].join(" ") : i &&= i.trim().split(/\s+/).join(" "), !r && !i && t && (r = t), {
		id: n,
		"aria-label": r,
		"aria-labelledby": i
	};
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/i18n/utils.mjs
var Ti = /* @__PURE__ */ new Set([
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
]), Ei = /* @__PURE__ */ new Set([
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
function Di(e) {
	if (Intl.Locale) {
		let t = new Intl.Locale(e).maximize(), n = typeof t.getTextInfo == "function" ? t.getTextInfo() : t.textInfo;
		if (n) return n.direction === "rtl";
		if (t.script) return Ti.has(t.script);
	}
	let t = e.split("-")[0];
	return Ei.has(t);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/i18n/useDefaultLocale.mjs
var Oi = Symbol.for("react-aria.i18n.locale");
function ki() {
	let e = typeof window < "u" && window[Oi] || typeof navigator < "u" && (navigator.language || navigator.userLanguage) || "en-US";
	try {
		Intl.DateTimeFormat.supportedLocalesOf([e]);
	} catch {
		e = "en-US";
	}
	return {
		locale: e,
		direction: Di(e) ? "rtl" : "ltr"
	};
}
var Ai = ki(), ji = /* @__PURE__ */ new Set();
function Mi() {
	Ai = ki();
	for (let e of ji) e(Ai);
}
function Ni() {
	let e = Ur(), [t, n] = (0, _.useState)(Ai);
	return (0, _.useEffect)(() => (ji.size === 0 && window.addEventListener("languagechange", Mi), ji.add(n), () => {
		ji.delete(n), ji.size === 0 && window.removeEventListener("languagechange", Mi);
	}), []), e ? {
		locale: typeof window < "u" && window[Oi] || "en-US",
		direction: "ltr"
	} : t;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/i18n/I18nProvider.mjs
var Pi = /*#__PURE__*/ _.createContext(null);
function Fi() {
	let e = Ni();
	return (0, _.useContext)(Pi) || e;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/utils/number.mjs
function Ii(e, t = -Infinity, n = Infinity) {
	return Math.min(Math.max(e, t), n);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria-components/dist/private/ProgressBar.mjs
var Li = /*#__PURE__*/ (0, _.createContext)(null), Ri = 7e3, zi = null;
function Bi(e, t = "assertive", n = Ri) {
	zi ? zi.announce(e, t, n) : (zi = new Vi(), (typeof IS_REACT_ACT_ENVIRONMENT == "boolean" ? IS_REACT_ACT_ENVIRONMENT : typeof jest < "u") ? zi.announce(e, t, n) : setTimeout(() => {
		zi?.isAttached() && zi?.announce(e, t, n);
	}, 100));
}
var Vi = class {
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
	announce(e, t = "assertive", n = Ri) {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/focusWithoutScrolling.mjs
function Hi(e) {
	if (Wi()) e.focus({ preventScroll: !0 });
	else {
		let t = Gi(e);
		e.focus(), Ki(t);
	}
}
var Ui = null;
function Wi() {
	if (Ui == null) {
		Ui = !1;
		try {
			document.createElement("div").focus({ get preventScroll() {
				return Ui = !0, !0;
			} });
		} catch {}
	}
	return Ui;
}
function Gi(e) {
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
function Ki(e) {
	for (let { element: t, scrollTop: n, scrollLeft: r } of e) t.scrollTop = n, t.scrollLeft = r;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/domHelpers.mjs
var F = (e) => Yi(e) ? e.document : Xi(e) ? e : e?.ownerDocument ?? (typeof document < "u" ? document : void 0), qi = (e) => F(e)?.defaultView ?? (typeof window < "u" ? window : void 0);
function Ji(e) {
	return typeof e == "object" && !!e && "nodeType" in e && typeof e.nodeType == "number";
}
function Yi(e) {
	return typeof e == "object" && !!e && "window" in e && e.window === e;
}
function Xi(e) {
	return Ji(e) && e.nodeType === 9;
}
function Zi(e) {
	return Ji(e) && e.nodeType === 11 && "host" in e;
}
function Qi(e, t, n, r) {
	if (n == null || e == null) return () => {};
	let i = Array.isArray(e) ? e : [e];
	for (let e of i) e.addEventListener(t, n, r);
	return () => {
		for (let e of i) e.removeEventListener(t, n, r);
	};
}
function $i(e, t, n, r) {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/flags/flags.mjs
var ea = !1;
function ta() {
	return ea;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/shadowdom/DOMFunctions.mjs
function I(e, t) {
	if (!ta()) return t && e ? e.contains(t) : !1;
	if (!e || !t) return !1;
	let n = t;
	for (; n !== null;) {
		if (n === e) return !0;
		n = typeof n.assignedElements != "function" && n.assignedSlot?.parentNode ? n.assignedSlot.parentNode : Zi(n) ? n.host : n.parentNode;
	}
	return !1;
}
var na = (e = document) => {
	if (!ta()) return e.activeElement;
	let t = e.activeElement;
	for (; t && "shadowRoot" in t && t.shadowRoot?.activeElement;) t = t.shadowRoot.activeElement;
	return t;
};
function L(e) {
	if (ta() && e.target instanceof Element && e.target.shadowRoot) {
		if ("composedPath" in e) return e.composedPath()[0] ?? null;
		if ("composedPath" in e.nativeEvent) return e.nativeEvent.composedPath()[0] ?? null;
	}
	return e.target;
}
function ra(e, t) {
	if (t === null) return [];
	t ??= qi(e);
	let n = [t];
	if (!ta() || !e || e === t) return n;
	let r = "getRootNode" in t ? t.getRootNode() : null, i = e.getRootNode() ?? null;
	for (; Zi(i) && i !== r;) n.push(i), i = i.host.getRootNode();
	return n;
}
function ia(e) {
	if (!e) return !1;
	let t = e.getRootNode(), n = qi(e);
	if (!(t instanceof n.Document || t instanceof n.ShadowRoot)) return !1;
	let r = t.activeElement;
	return r != null && e.contains(r);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/isElementVisible.mjs
var aa = typeof Element < "u" && "checkVisibility" in Element.prototype;
function oa(e) {
	let t = qi(e);
	if (!(e instanceof t.HTMLElement) && !(e instanceof t.SVGElement)) return !1;
	let { display: n, visibility: r } = e.style, i = n !== "none" && r !== "hidden" && r !== "collapse";
	if (i) {
		let { getComputedStyle: t } = qi(e), { display: n, visibility: r } = t(e);
		i = n !== "none" && r !== "hidden" && r !== "collapse";
	}
	return i;
}
function R(e, t) {
	return !e.hasAttribute("hidden") && !e.hasAttribute("data-react-aria-prevent-focus") && (e.nodeName === "DETAILS" && t && t.nodeName !== "SUMMARY" ? e.hasAttribute("open") : !0);
}
function sa(e, t) {
	return aa ? e.checkVisibility({ visibilityProperty: !0 }) && !e.closest("[data-react-aria-prevent-focus]") : e.nodeName !== "#comment" && oa(e) && R(e, t) && (!e.parentElement || sa(e.parentElement, e));
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/isFocusable.mjs
var ca = [
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
], la = ca.join(":not([hidden]),") + ",[tabindex]:not([disabled]):not([hidden])";
ca.push("[tabindex]:not([tabindex=\"-1\"]):not([disabled])");
var ua = ca.join(":not([hidden]):not([tabindex=\"-1\"]),");
function da(e, t) {
	return e.matches(la) && !pa(e) && (t?.skipVisibilityCheck || sa(e));
}
function fa(e) {
	return e.matches(ua) && sa(e) && !pa(e);
}
function pa(e) {
	let t = e;
	for (; t != null;) {
		if (t instanceof qi(t).HTMLElement && t.inert) return !0;
		t = t.parentElement;
	}
	return !1;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/utils.mjs
function ma(e) {
	let t = e;
	return t.nativeEvent = e, t.isDefaultPrevented = () => t.defaultPrevented, t.isPropagationStopped = () => t.cancelBubble, t.persist = () => {}, t;
}
function ha(e, t) {
	Object.defineProperty(e, "target", { value: t }), Object.defineProperty(e, "currentTarget", { value: t });
}
function ga(e) {
	let t = (0, _.useRef)({
		isFocused: !1,
		observer: null
	});
	return P(() => {
		let e = t.current;
		return () => {
			e.observer &&= (e.observer.disconnect(), null);
		};
	}, []), (0, _.useCallback)((n) => {
		let r = L(n);
		if (r instanceof HTMLButtonElement || r instanceof HTMLInputElement || r instanceof HTMLTextAreaElement || r instanceof HTMLSelectElement) {
			t.current.isFocused = !0;
			let n = r;
			n.addEventListener("focusout", (r) => {
				if (t.current.isFocused = !1, n.disabled) {
					let t = ma(r);
					e?.(t);
				}
				t.current.observer && (t.current.observer.disconnect(), t.current.observer = null);
			}, { once: !0 }), t.current.observer = new MutationObserver(() => {
				if (t.current.isFocused && n.disabled) {
					t.current.observer?.disconnect();
					let e = n === na() ? null : na();
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
var _a = !1;
function va(e) {
	for (; e && !da(e, { skipVisibilityCheck: !0 });) e = e.parentElement;
	let t = na(qi(e).document);
	if (!t || t === e) return;
	let n = e?.getRootNode(), r = n != null && Zi(n) ? n : qi(e), i = (t) => t === e || t != null && I(e, t), a = (e) => e === t || t != null && e != null && I(t, e);
	_a = !0;
	let o = !1, s = (e) => {
		(a(L(e)) || o) && e.stopImmediatePropagation();
	}, c = (n) => {
		(a(L(n)) || o) && (n.stopImmediatePropagation(), !e && !o && (o = !0, Hi(t), d()));
	}, l = (e) => {
		(i(L(e)) || o) && e.stopImmediatePropagation();
	}, u = (e) => {
		(i(L(e)) || o) && (e.stopImmediatePropagation(), o || (o = !0, Hi(t), d()));
	};
	r.addEventListener("blur", s, !0), r.addEventListener("focusout", c, !0), r.addEventListener("focusin", u, !0), r.addEventListener("focus", l, !0);
	let d = () => {
		cancelAnimationFrame(f), r.removeEventListener("blur", s, !0), r.removeEventListener("focusout", c, !0), r.removeEventListener("focusin", u, !0), r.removeEventListener("focus", l, !0), _a = !1, o = !1;
	}, f = requestAnimationFrame(d);
	return d;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/platform.mjs
function ya(e) {
	if (typeof window > "u" || window.navigator == null) return !1;
	let t = window.navigator.userAgentData?.brands;
	return Array.isArray(t) && t.some((t) => e.test(t.brand)) || e.test(window.navigator.userAgent);
}
function ba(e) {
	return typeof window < "u" && window.navigator != null && e.test(window.navigator.userAgentData?.platform || window.navigator.platform);
}
function xa(e) {
	let t = null;
	return () => (t ??= e(), t);
}
var Sa = xa(function() {
	return ba(/^Mac/i);
}), Ca = xa(function() {
	return ba(/^iPhone/i);
}), wa = xa(function() {
	return ba(/^iPad/i) || Sa() && navigator.maxTouchPoints > 1;
}), Ta = xa(function() {
	return Ca() || wa();
}), Ea = xa(function() {
	return Sa() || Ta();
}), Da = xa(function() {
	return ya(/AppleWebKit/i) && (Ta() || !Oa());
}), Oa = xa(function() {
	return ya(/Chrome|CriOS|CrMo/i);
}), ka = xa(function() {
	return ya(/Android/i);
}), Aa = xa(function() {
	return ya(/(Firefox|FxiOS)/i);
});
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/isVirtualEvent.mjs
function ja(e) {
	return e.pointerType === "" && e.isTrusted ? !0 : ka() && e.pointerType ? e.type === "click" && e.buttons === 1 : e.detail === 0 && !e.pointerType;
}
function Ma(e) {
	return !ka() && e.width === 0 && e.height === 0 || ka() && e.width === 1 && e.height === 1 && e.pressure === 0 && e.detail === 0 && e.pointerType === "mouse";
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/openLink.mjs
var Na = /*#__PURE__*/ (0, _.createContext)({
	isNative: !0,
	open: Ra,
	useHref: (e) => e
});
function Pa() {
	return (0, _.useContext)(Na);
}
function Fa(e, t) {
	let n = e.getAttribute("target");
	return (!n || n === "_self") && e.origin === location.origin && !e.hasAttribute("download") && !t.metaKey && !t.ctrlKey && !t.altKey && !t.shiftKey;
}
function Ia(e, t, n = !0) {
	let { metaKey: r, ctrlKey: i, altKey: a, shiftKey: o } = t;
	!Da() && Aa() && window.event?.type?.startsWith("key") && e.target === "_blank" && (Sa() ? r = !0 : i = !0);
	let s = Da() && Sa() && !wa() ? new KeyboardEvent("keydown", {
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
	Ia.isOpening = n, Hi(e), e.dispatchEvent(s), Ia.isOpening = !1;
}
Ia.isOpening = !1;
function La(e, t) {
	if (e instanceof HTMLAnchorElement) t(e);
	else if (e.hasAttribute("data-href")) {
		let n = document.createElement("a");
		n.href = e.getAttribute("data-href"), e.hasAttribute("data-target") && (n.target = e.getAttribute("data-target")), e.hasAttribute("data-rel") && (n.rel = e.getAttribute("data-rel")), e.hasAttribute("data-download") && (n.download = e.getAttribute("data-download")), e.hasAttribute("data-ping") && (n.ping = e.getAttribute("data-ping")), e.hasAttribute("data-referrer-policy") && (n.referrerPolicy = e.getAttribute("data-referrer-policy")), e.appendChild(n), t(n), e.removeChild(n);
	}
}
function Ra(e, t) {
	La(e, (e) => Ia(e, t));
}
function za(e) {
	let t = Pa().useHref(e?.href ?? ""), n = {};
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
function Ba(e, t, n, r) {
	!t.isNative && e.currentTarget instanceof HTMLAnchorElement && e.currentTarget.href && !e.isDefaultPrevented() && Fa(e.currentTarget, e) && n && (e.preventDefault(), t.open(e.currentTarget, e, n, r));
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useFocusVisible.mjs
var Va = null, Ha = /* @__PURE__ */ new Set(), Ua = /* @__PURE__ */ new Map(), Wa = !1, Ga = !1, Ka = {
	Tab: !0,
	Escape: !0
};
function qa(e, t) {
	for (let n of Ha) n(e, t);
}
function Ja(e) {
	return !(e.metaKey || !Sa() && e.altKey || e.ctrlKey || e.key === "Control" || e.key === "Shift" || e.key === "Meta");
}
function Ya(e) {
	Wa = !0, !Ia.isOpening && Ja(e) && (Va = "keyboard", qa("keyboard", e));
}
function Xa(e) {
	Va = "pointer", "pointerType" in e && e.pointerType, (e.type === "mousedown" || e.type === "pointerdown") && (Wa = !0, qa("pointer", e));
}
function Za(e) {
	!Ia.isOpening && ja(e) && (Wa = !0, Va = "virtual");
}
function Qa(e) {
	if (_a) return;
	let t = L(e), n = qi(t), r = F(t);
	if (t === n) {
		Ga = !0;
		return;
	}
	t !== r && e.isTrusted && (!Wa && !Ga && (Va = "virtual", qa("virtual", e)), Wa = !1, Ga = !1);
}
function $a() {
	_a || (Wa = !1, Ga = !0);
}
function eo(e) {
	if (typeof window > "u" || typeof document > "u") return;
	let t = qi(e), n = F(e);
	if (Ua.get(t)) return;
	let r = t.HTMLElement.prototype.focus;
	Reflect.defineProperty(t.HTMLElement.prototype, "focus", {
		configurable: !0,
		writable: !0,
		value: function() {
			Wa = !0, r.apply(this, arguments);
		}
	}), n.addEventListener("keydown", Ya, !0), n.addEventListener("keyup", Ya, !0), n.addEventListener("click", Za, !0), t.addEventListener("focus", Qa, !0), t.addEventListener("blur", $a, !1), typeof PointerEvent < "u" && (n.addEventListener("pointerdown", Xa, !0), n.addEventListener("pointermove", Xa, !0), n.addEventListener("pointerup", Xa, !0)), t.addEventListener("beforeunload", () => {
		to(e);
	}, { once: !0 }), Ua.set(t, { focus: r });
}
var to = (e, t) => {
	let n = qi(e), r = F(e);
	t && r.removeEventListener("DOMContentLoaded", t), Ua.has(n) && (Reflect.defineProperty(n.HTMLElement.prototype, "focus", {
		configurable: !0,
		writable: !0,
		value: Ua.get(n).focus
	}), r.removeEventListener("keydown", Ya, !0), r.removeEventListener("keyup", Ya, !0), r.removeEventListener("click", Za, !0), n.removeEventListener("focus", Qa, !0), n.removeEventListener("blur", $a, !1), typeof PointerEvent < "u" && (r.removeEventListener("pointerdown", Xa, !0), r.removeEventListener("pointermove", Xa, !0), r.removeEventListener("pointerup", Xa, !0)), Ua.delete(n));
};
function no(e) {
	let t = F(e), n;
	return t.readyState === "loading" ? (n = () => {
		eo(e);
	}, t.addEventListener("DOMContentLoaded", n)) : eo(e), () => to(e, n);
}
typeof document < "u" && no();
function ro() {
	return Va !== "pointer";
}
function io() {
	return Va;
}
function ao(e) {
	Va = e, qa(e, null);
}
var oo = /* @__PURE__ */ new Set([
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
function so(e, t, n) {
	let r = n ? L(n) : void 0, i = F(r), a = qi(r), o = a === void 0 ? HTMLInputElement : a.HTMLInputElement, s = a === void 0 ? HTMLTextAreaElement : a.HTMLTextAreaElement, c = a === void 0 ? HTMLElement : a.HTMLElement, l = a === void 0 ? KeyboardEvent : a.KeyboardEvent, u = na(i);
	return e = e || u instanceof o && !oo.has(u.type) || u instanceof s || u instanceof c && u.isContentEditable, !(e && t === "keyboard" && n instanceof l && !Ka[n.key]);
}
function co(e, t, n) {
	eo(), (0, _.useEffect)(() => {
		if (n?.enabled === !1) return;
		let t = (t, r) => {
			so(!!n?.isTextInput, t, r) && e(ro());
		};
		return Ha.add(t), () => {
			Ha.delete(t);
		};
	}, t);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/runAfterTransition.mjs
var lo = /* @__PURE__ */ new Map(), uo = /* @__PURE__ */ new Set();
function fo() {
	if (typeof window > "u") return;
	function e(e) {
		return "propertyName" in e;
	}
	let t = (t) => {
		let r = L(t);
		if (!e(t) || !r) return;
		let i = lo.get(r);
		i || (i = /* @__PURE__ */ new Set(), lo.set(r, i), r.addEventListener("transitioncancel", n, { once: !0 })), i.add(t.propertyName);
	}, n = (t) => {
		let r = L(t);
		if (!e(t) || !r) return;
		let i = lo.get(r);
		if (i && (i.delete(t.propertyName), i.size === 0 && (r.removeEventListener("transitioncancel", n), lo.delete(r)), lo.size === 0)) {
			for (let e of uo) e();
			uo.clear();
		}
	};
	document.body.addEventListener("transitionrun", t), document.body.addEventListener("transitionend", n);
}
typeof document < "u" && (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fo) : fo());
function po() {
	for (let [e] of lo) "isConnected" in e && !e.isConnected && lo.delete(e);
}
function mo(e) {
	requestAnimationFrame(() => {
		po(), lo.size === 0 ? e() : uo.add(e);
	});
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/focusSafely.mjs
function ho(e) {
	if (!e.isConnected) return;
	let t = F(e);
	if (io() === "virtual") {
		let n = na(t);
		mo(() => {
			let r = na(t);
			(r === n || r === t.body) && e.isConnected && Hi(e);
		});
	} else Hi(e);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useFocus.mjs
function go(e) {
	let { isDisabled: t, onFocus: n, onBlur: r, onFocusChange: i } = e, a = (0, _.useCallback)((e) => {
		if (L(e) === e.currentTarget) return r && r(e), i && i(!1), !0;
	}, [r, i]), o = ga(a), s = (0, _.useCallback)((e) => {
		let t = L(e), r = F(t), a = r ? na(r) : na();
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/createEventHandler.mjs
function _o(e) {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/createKeyboardShortcutHandler.mjs
var vo = /* @__PURE__ */ new Set([
	"shift",
	"alt",
	"control",
	"meta",
	"mod"
]), yo = [
	"Alt",
	"Control",
	"Meta",
	"Shift"
];
function bo(e) {
	let t = /* @__PURE__ */ new Set();
	return e.alt && t.add("Alt"), e.shift && t.add("Shift"), e.ctrl && t.add("Control"), e.meta && t.add("Meta"), e.mod && t.add(Sa() ? "Meta" : "Control"), t;
}
function xo(e) {
	let t = /* @__PURE__ */ new Set();
	return e.altKey && t.add("Alt"), e.ctrlKey && t.add("Control"), e.metaKey && t.add("Meta"), e.shiftKey && t.add("Shift"), t;
}
function So(e) {
	return yo.filter((t) => e.has(t));
}
function Co(e) {
	let t = e.split("+").reduce((e, t) => {
		let n = t.toLowerCase();
		return vo.has(n) ? n === "shift" ? e.shift = !0 : n === "alt" ? e.alt = !0 : n === "control" ? e.ctrl = !0 : n === "meta" ? e.meta = !0 : n === "mod" && (e.mod = !0) : e.key = t, e;
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
function wo(e) {
	return e.toLowerCase();
}
var To = {
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
function Eo(e) {
	let t = wo(e);
	return To[t] ?? t;
}
function Do(e) {
	let t = So(bo(e)), n = Eo(e.key);
	return t.length > 0 ? `${t.join("+")}+${n}` : n;
}
function Oo(e) {
	let t = So(xo(e)), n = wo(e.key);
	return (t.length > 0 ? `${t.join("+")}+` : "") + n;
}
function ko(e) {
	let t = /* @__PURE__ */ new Map();
	for (let [n, r] of Object.entries(e)) {
		let e = Co(n);
		t.set(Do(e), r);
	}
	return (e) => {
		let n = Oo(e), r = t.get(n), i = r?.(e);
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useKeyboard.mjs
function Ao(e) {
	let { shortcuts: t, allowRepeats: n = !1, allowComposing: r = !1 } = e, i, a;
	if (t) {
		let o = ko(t), s = _o((e) => {
			if (!I(e.currentTarget, L(e))) {
				e.continuePropagation();
				return;
			}
			if (e.nativeEvent?.repeat && !n || e.nativeEvent?.isComposing && !r) {
				e.continuePropagation();
				return;
			}
			o(e);
		}), c = _o((e) => {
			if (!I(e.currentTarget, L(e))) {
				e.continuePropagation();
				return;
			}
			if (e.nativeEvent?.repeat && !n || e.nativeEvent?.isComposing && !r) {
				e.continuePropagation();
				return;
			}
			e.continuePropagation();
		});
		i = e.onKeyDown ? jr(e.onKeyDown, s) : s, a = e.onKeyUp ? jr(e.onKeyUp, c) : c;
	} else i = _o(e.onKeyDown), a = _o(e.onKeyUp);
	return { keyboardProps: e.isDisabled ? {} : {
		onKeyDown: i,
		onKeyUp: a
	} };
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useSyncRef.mjs
function jo(e, t) {
	P(() => {
		if (e && e.ref && t) return e.ref.current = t.current, () => {
			e.ref && (e.ref.current = null);
		};
	});
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useFocusable.mjs
var Mo = /*#__PURE__*/ _.createContext(null);
function No(e) {
	let t = (0, _.useContext)(Mo) || {};
	jo(t, e);
	let { ref: n, ...r } = t;
	return r;
}
function Po(e, t) {
	let { focusProps: n } = go(e), { keyboardProps: r } = Ao(e), i = ni(n, r), a = No(t), o = e.isDisabled ? {} : a, s = (0, _.useRef)(e.autoFocus);
	(0, _.useEffect)(() => {
		s.current && t.current && ho(t.current), s.current = !1;
	}, [t]);
	let c = e.excludeFromTabOrder ? -1 : 0;
	return e.isDisabled && (c = void 0), { focusableProps: ni({
		...i,
		tabIndex: c
	}, o) };
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/textSelection.mjs
var Fo = "default", Io = "", Lo = /* @__PURE__ */ new WeakMap();
function Ro(e) {
	if (Ta() && Da()) {
		if (Fo === "default") {
			let t = F(e);
			Io = t.documentElement.style.webkitUserSelect, t.documentElement.style.webkitUserSelect = "none";
		}
		Fo = "disabled";
	} else if (e instanceof HTMLElement || e instanceof SVGElement) {
		let t = "userSelect" in e.style ? "userSelect" : "webkitUserSelect";
		Lo.set(e, e.style[t]), e.style[t] = "none";
	}
}
function zo(e) {
	if (Ta() && Da()) {
		if (Fo !== "disabled") return;
		Fo = "restoring", setTimeout(() => {
			mo(() => {
				if (Fo === "restoring") {
					let t = F(e);
					t.documentElement.style.webkitUserSelect === "none" && (t.documentElement.style.webkitUserSelect = Io || ""), Io = "", Fo = "default";
				}
			});
		}, 300);
	} else if ((e instanceof HTMLElement || e instanceof SVGElement) && e && Lo.has(e)) {
		let t = Lo.get(e), n = "userSelect" in e.style ? "userSelect" : "webkitUserSelect";
		e.style[n] === "none" && (e.style[n] = t), e.getAttribute("style") === "" && e.removeAttribute("style"), Lo.delete(e);
	}
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/getMetaValue.mjs
function Bo(e, t) {
	let n = qi(t), r = F(t);
	if (r == null || n == null) return;
	let i, a = `meta[name="${CSS.escape(e)}"], meta[property="${CSS.escape(e)}"]`, o = r.querySelector(a);
	return o && o instanceof n.HTMLMetaElement && (e === "csp-nonce" && o.nonce && (i ??= o.nonce || void 0), o.content && (i ??= o.content || void 0)), e === "csp-nonce" && (i ??= n.__webpack_nonce__ || globalThis.__webpack_nonce__ || void 0), i;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/getNonce.mjs
var Vo = /* @__PURE__ */ new WeakMap();
function Ho(e) {
	let t = F(e), n = Vo.get(t);
	return n ??= Bo("csp-nonce", t), n !== void 0 && Vo.set(t, n), n;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/context.mjs
var Uo = _.createContext({ register: () => {} });
Uo.displayName = "PressResponderContext";
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useEffectEvent.mjs
var Wo = _.useInsertionEffect ?? P;
function z(e) {
	let t = (0, _.useRef)(null);
	return Wo(() => {
		t.current = e;
	}, [e]), (0, _.useCallback)((...e) => {
		let n = t.current;
		return n?.(...e);
	}, []);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useGlobalListeners.mjs
function Go() {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/usePress.mjs
var Ko = /* @__PURE__ */ c(m(), 1);
function qo(e) {
	let t = (0, _.useContext)(Uo);
	if (t) {
		let { register: n, ref: r, ...i } = t;
		e = ni(i, e), n();
	}
	return jo(t, e.ref), e;
}
var Jo = class {
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
}, Yo = Symbol("linkClicked"), Xo = "react-aria-pressable-style", Zo = "data-react-aria-pressable";
function Qo(e) {
	let { onPress: t, onPressChange: n, onPressStart: r, onPressEnd: i, onPressUp: a, onClick: o, isDisabled: s, isPressed: c, preventFocusOnPress: l, shouldCancelOnPointerExit: u, allowTextSelectionOnPress: d, ref: f, ...p } = qo(e), [m, h] = (0, _.useState)(!1), g = (0, _.useRef)({
		isPressed: !1,
		ignoreEmulatedMouseEvents: !1,
		didFirePressStart: !1,
		isTriggeringEvent: !1,
		activePointerId: null,
		target: null,
		isOverTarget: !1,
		pointerType: null,
		disposables: []
	}), { addGlobalListener: v, removeAllGlobalListeners: y } = Go(), b = (0, _.useCallback)((e, t) => {
		let i = g.current;
		if (s || i.didFirePressStart) return !1;
		let a = !0;
		if (i.isTriggeringEvent = !0, r) {
			let n = new Jo("pressstart", t, e);
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
			let t = new Jo("pressend", r, e);
			i(t), c = t.shouldStopPropagation;
		}
		if (n && n(!1), h(!1), t && a && !s) {
			let n = new Jo("press", r, e);
			t(n), c &&= n.shouldStopPropagation;
		}
		return o.isTriggeringEvent = !1, c;
	}, [
		s,
		i,
		n,
		t
	]), S = z(x), C = z((0, _.useCallback)((e, t) => {
		let n = g.current;
		if (s) return !1;
		if (a) {
			n.isTriggeringEvent = !0;
			let r = new Jo("pressup", t, e);
			return a(r), n.isTriggeringEvent = !1, r.shouldStopPropagation;
		}
		return !0;
	}, [s, a])), w = (0, _.useCallback)((e) => {
		let t = g.current;
		if (t.isPressed && t.target) {
			t.didFirePressStart && t.pointerType != null && x(ts(t.target, e), t.pointerType, !1), t.isPressed = !1, t.isOverTarget = !1, t.activePointerId = null, t.pointerType = null, y(), d || zo(t.target);
			for (let e of t.disposables) e();
			t.disposables = [];
		}
	}, [
		d,
		y,
		x
	]), T = z(w);
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
			ha(n, t), o(ma(n));
		}
	}, [s, o]), ne = (0, _.useMemo)(() => {
		let e = g.current, t = {
			onKeyDown(t) {
				if (es(t.nativeEvent, t.currentTarget) && I(t.currentTarget, L(t))) {
					rs(L(t), t.key) && t.preventDefault();
					let r = !0;
					!e.isPressed && !t.repeat && (e.target = t.currentTarget, e.isPressed = !0, e.pointerType = "keyboard", r = b(t, "keyboard"));
					let i = t.currentTarget;
					v(F(t.currentTarget), "keyup", jr((t) => {
						es(t, i) && !t.repeat && I(i, L(t)) && e.target && C(ts(e.target, t), "keyboard");
					}, n), !0), r && t.stopPropagation(), t.metaKey && Sa() && e.metaKeyEvents?.set(t.key, t.nativeEvent);
				} else t.key === "Meta" && (e.metaKeyEvents = /* @__PURE__ */ new Map());
			},
			onClick(t) {
				if ((!t || I(t.currentTarget, L(t))) && t && t.button === 0 && !e.isTriggeringEvent && !Ia.isOpening) {
					let n = !0;
					if (s && t.preventDefault(), !e.ignoreEmulatedMouseEvents && !e.isPressed && (e.pointerType === "virtual" || ja(t.nativeEvent))) {
						let e = b(t, "virtual"), r = C(t, "virtual"), i = S(t, "virtual");
						E(t), n = e && r && i;
					} else if (e.isPressed && e.pointerType !== "keyboard") {
						let r = e.pointerType || t.nativeEvent.pointerType || "virtual", i = C(ts(t.currentTarget, t), r), a = S(ts(t.currentTarget, t), r, !0);
						n = i && a, e.isOverTarget = !1, E(t), T(t);
					}
					e.ignoreEmulatedMouseEvents = !1, n && t.stopPropagation();
				}
			}
		}, n = (t) => {
			if (e.isPressed && e.target && es(t, e.target)) {
				rs(L(t), t.key) && t.preventDefault();
				let n = L(t), r = I(e.target, n);
				S(ts(e.target, t), "keyboard", r), r && te(t, e.target), y(), t.key !== "Enter" && $o(e.target) && I(e.target, n) && !t[Yo] && (t[Yo] = !0, Ia(e.target, t, !1)), e.isPressed = !1, e.metaKeyEvents?.delete(t.key);
			} else if (t.key === "Meta" && e.metaKeyEvents?.size) {
				let t = e.metaKeyEvents;
				e.metaKeyEvents = void 0;
				for (let n of t.values()) e.target?.dispatchEvent(new KeyboardEvent("keyup", n));
			}
		};
		if (typeof PointerEvent < "u") {
			t.onPointerDown = (t) => {
				if (t.button !== 0 || !I(t.currentTarget, L(t))) return;
				if (Ma(t.nativeEvent)) {
					e.pointerType = "virtual";
					return;
				}
				e.pointerType = t.pointerType;
				let i = !0;
				if (!e.isPressed) {
					e.isPressed = !0, e.isOverTarget = !0, e.activePointerId = t.pointerId, e.target = t.currentTarget, d || Ro(e.target), i = b(t, e.pointerType);
					let a = L(t);
					"releasePointerCapture" in a && ("hasPointerCapture" in a ? a.hasPointerCapture(t.pointerId) && a.releasePointerCapture(t.pointerId) : a.releasePointerCapture(t.pointerId)), v(F(t.currentTarget), "pointerup", n, !1), v(F(t.currentTarget), "pointercancel", r, !1);
				}
				i && t.stopPropagation();
			}, t.onMouseDown = (t) => {
				if (I(t.currentTarget, L(t)) && t.button === 0) {
					if (l) {
						let n = va(t.target);
						n && e.disposables.push(n);
					}
					t.stopPropagation();
				}
			}, t.onPointerUp = (t) => {
				I(t.currentTarget, L(t)) && e.pointerType !== "virtual" && t.button === 0 && !e.isPressed && C(t, e.pointerType || t.pointerType);
			}, t.onPointerEnter = (t) => {
				t.pointerId === e.activePointerId && e.target && !e.isOverTarget && e.pointerType != null && (e.isOverTarget = !0, b(ts(e.target, t), e.pointerType));
			}, t.onPointerLeave = (t) => {
				t.pointerId === e.activePointerId && e.target && e.isOverTarget && e.pointerType != null && (e.isOverTarget = !1, S(ts(e.target, t), e.pointerType, !1), ee(t));
			};
			let n = (t) => {
				if (t.pointerId === e.activePointerId && e.isPressed && t.button === 0 && e.target) {
					if (I(e.target, L(t)) && e.pointerType != null) {
						let n = !1, r = setTimeout(() => {
							e.isPressed && e.target instanceof HTMLElement && (n ? T(t) : (Hi(e.target), e.target.click()));
						}, 80);
						v(t.currentTarget, "click", () => n = !0, !0), e.disposables.push(() => clearTimeout(r));
					} else T(t);
					e.isOverTarget = !1;
				}
			}, r = (e) => {
				T(e);
			};
			t.onDragStart = (e) => {
				I(e.currentTarget, L(e)) && T(e);
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
		let e = F(f.current);
		if (!e || !e.head || e.getElementById(Xo)) return;
		let t = e.createElement("style");
		t.id = Xo;
		let n = Ho(e);
		n && (t.nonce = n), t.textContent = `
@layer {
  [${Zo}] {
    touch-action: pan-x pan-y pinch-zoom;
  }
}
    `.trim(), e.head.prepend(t);
	}, [f]), (0, _.useEffect)(() => {
		let e = g.current;
		return () => {
			d || zo(e.target ?? void 0);
			for (let t of e.disposables) t();
			e.disposables = [];
		};
	}, [d]), {
		isPressed: c || m,
		pressProps: ni(p, ne, { [Zo]: !0 })
	};
}
function $o(e) {
	return e.tagName === "A" && e.hasAttribute("href");
}
function es(e, t) {
	let { key: n, code: r } = e, i = t, a = i.getAttribute("role");
	return (n === "Enter" || n === " " || n === "Spacebar" || r === "Space") && !(i instanceof qi(i).HTMLInputElement && !as(i, n) || i instanceof qi(i).HTMLTextAreaElement || i.isContentEditable) && !((a === "link" || !a && $o(i)) && n !== "Enter");
}
function ts(e, t) {
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
function ns(e) {
	return e instanceof HTMLInputElement ? !1 : e instanceof HTMLButtonElement ? e.type !== "submit" && e.type !== "reset" : !$o(e);
}
function rs(e, t) {
	return Sa() && t === "Enter" ? !1 : e instanceof HTMLInputElement ? t === "Enter" && (e.type === "checkbox" || e.type === "radio") ? !1 : !as(e, t) : ns(e);
}
var is = /* @__PURE__ */ new Set([
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
function as(e, t) {
	return e.type === "checkbox" || e.type === "radio" ? t === " " : is.has(e.type);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/button/useButton.mjs
function os(e, t) {
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
	let { pressProps: _, isPressed: v } = Qo({
		onPressStart: a,
		onPressEnd: o,
		onPressChange: c,
		onPress: i,
		onPressUp: s,
		onClick: d,
		isDisabled: r,
		preventFocusOnPress: l,
		ref: t
	}), { focusableProps: y } = Po(e, t);
	u && (y.tabIndex = r ? -1 : y.tabIndex);
	let b = ni(y, _, Ci(e, { labelable: !0 }));
	return {
		isPressed: v,
		buttonProps: ni(g, b, {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useFocusWithin.mjs
function ss(e) {
	let { isDisabled: t, onBlurWithin: n, onFocusWithin: r, onFocusWithinChange: i } = e, a = (0, _.useRef)({ isFocusWithin: !1 }), { addGlobalListener: o, removeAllGlobalListeners: s } = Go(), c = (0, _.useCallback)((e) => {
		I(e.currentTarget, L(e)) && a.current.isFocusWithin && !I(e.currentTarget, e.relatedTarget) && (a.current.isFocusWithin = !1, s(), n && n(e), i && i(!1));
	}, [
		n,
		i,
		a,
		s
	]), l = ga(c), u = (0, _.useCallback)((e) => {
		if (!I(e.currentTarget, L(e))) return;
		let t = L(e), n = F(t), s = na(n);
		if (!a.current.isFocusWithin && s === t) {
			r && r(e), i && i(!0), a.current.isFocusWithin = !0, l(e);
			let t = e.currentTarget;
			o(n, "focus", (e) => {
				let r = L(e);
				if (a.current.isFocusWithin && !I(t, r)) {
					let e = new n.defaultView.FocusEvent("blur", { relatedTarget: r });
					ha(e, t);
					let i = ma(e);
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/focus/useFocusRing.mjs
function cs(e = {}) {
	let { autoFocus: t = !1, isTextInput: n, within: r } = e, i = (0, _.useRef)({
		isFocused: !1,
		isFocusVisible: t || ro()
	}), [a, o] = (0, _.useState)(!1), [s, c] = (0, _.useState)(() => i.current.isFocused && i.current.isFocusVisible), l = (0, _.useCallback)(() => c(i.current.isFocused && i.current.isFocusVisible), []), u = (0, _.useCallback)((e) => {
		i.current.isFocused = e, i.current.isFocusVisible = ro(), o(e), l();
	}, [l]);
	co((e) => {
		i.current.isFocusVisible = e, l();
	}, [n, a], {
		enabled: a,
		isTextInput: n
	});
	let { focusProps: d } = go({
		isDisabled: r,
		onFocusChange: u
	}), { focusWithinProps: f } = ss({
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useHover.mjs
var ls = !1, us = 0;
function ds() {
	ls = !0, setTimeout(() => {
		ls = !1;
	}, 500);
}
function fs(e) {
	e.pointerType === "touch" && ds();
}
function ps() {
	let e = F(null);
	if (e !== void 0) return us === 0 && typeof PointerEvent < "u" && e.addEventListener("pointerup", fs), us++, () => {
		us--, !(us > 0) && typeof PointerEvent < "u" && e.removeEventListener("pointerup", fs);
	};
}
function ms(e) {
	let { onHoverStart: t, onHoverChange: n, onHoverEnd: r, isDisabled: i } = e, [a, o] = (0, _.useState)(!1), s = (0, _.useRef)({
		isHovered: !1,
		ignoreEmulatedMouseEvents: !1,
		pointerType: "",
		target: null
	}).current;
	(0, _.useEffect)(ps, []);
	let { addGlobalListener: c, removeAllGlobalListeners: l } = Go(), { hoverProps: u, triggerHoverEnd: d } = (0, _.useMemo)(() => {
		let e = (e, r) => {
			if (s.pointerType = r, i || r === "touch" || s.isHovered || !I(e.currentTarget, L(e))) return;
			s.isHovered = !0;
			let l = e.currentTarget;
			s.target = l, c(F(L(e)), "pointerover", (e) => {
				s.isHovered && s.target && !I(s.target, L(e)) && a(e, e.pointerType);
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
			ls && t.pointerType === "mouse" || e(t, t.pointerType);
		}, u.onPointerLeave = (e) => {
			!i && I(e.currentTarget, L(e)) && a(e, e.pointerType);
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria-components/dist/private/Button.mjs
var hs = /*#__PURE__*/ (0, _.createContext)({}), gs = /*#__PURE__*/ hi(function(e, t) {
	[e, t] = ci(e, t, hs);
	let n = e, { isPending: r } = n, { buttonProps: i, isPressed: a } = os(e, t);
	i = vs(i, r);
	let { focusProps: o, isFocused: s, isFocusVisible: c } = cs(e), { hoverProps: l, isHovered: u } = ms({
		...e,
		isDisabled: e.isDisabled || r
	}), d = {
		isHovered: u,
		isPressed: (n.isPressed || a) && !r,
		isFocused: s,
		isFocusVisible: c,
		isDisabled: e.isDisabled || !1,
		isPending: r ?? !1
	}, f = oi({
		...e,
		values: d,
		defaultClassName: "react-aria-Button"
	}), p = Yr(i.id), m = Yr(), h = i["aria-labelledby"];
	r && (h ? h = `${h} ${m}` : i["aria-label"] && (h = `${p} ${m}`));
	let g = (0, _.useRef)(r);
	(0, _.useEffect)(() => {
		let e = { "aria-labelledby": h || p };
		(!g.current && s && r || g.current && s && !r) && Bi(e, "assertive"), g.current = r;
	}, [
		r,
		s,
		h,
		p
	]);
	let v = Ci(e, { global: !0 });
	return delete v.onClick, /*#__PURE__*/ _.createElement(fi.button, {
		...ni(v, f, i, o, l),
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
	}, /*#__PURE__*/ _.createElement(Li.Provider, { value: { id: m } }, f.children));
}), _s = /Focus|Blur|Hover|Pointer(Enter|Leave|Over|Out)|Mouse(Enter|Leave|Over|Out)/;
function vs(e, t) {
	if (t) {
		for (let t in e) t.startsWith("on") && !_s.test(t) && (e[t] = void 0);
		e.href = void 0, e.target = void 0;
	}
	return e;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/collections/BaseCollection.mjs
var ys = class {
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
}, bs = class extends ys {
	filter(e, t, n) {
		let [r, i] = Es(e, t, this.firstChildKey, n), a = this.clone();
		return a.firstChildKey = r, a.lastChildKey = i, a;
	}
}, xs = class extends ys {
	static {
		this.type = "header";
	}
}, Ss = class extends ys {
	static {
		this.type = "loader";
	}
}, Cs = class extends bs {
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
}, ws = class extends bs {
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
}, Ts = class {
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
		let t = new this.constructor(), [n, r] = Es(this, t, this.firstKey, e);
		return t?.commit(n, r), t;
	}
	constructor() {
		this.keyMap = /* @__PURE__ */ new Map(), this.firstKey = null, this.lastKey = null, this.frozen = !1, this.itemCount = 0;
	}
};
function Es(e, t, n, r) {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/collections/Document.mjs
var Ds = class {
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
}, Os = class e extends Ds {
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
}, ks = class extends Ds {
	constructor(e) {
		super(null), this.nodeType = 11, this.ownerDocument = this, this.dirtyNodes = /* @__PURE__ */ new Set(), this.isSSR = !1, this.nodeId = 0, this.nodesByProps = /* @__PURE__ */ new WeakMap(), this.nextCollection = null, this.subscriptions = /* @__PURE__ */ new Set(), this.queuedRender = !1, this.inSubscription = !1, this.collection = e, this.nextCollection = e;
	}
	get isConnected() {
		return !0;
	}
	createElement(e) {
		return new Os(e, this);
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
		for (let e of this.dirtyNodes) e instanceof Os && (!e.isConnected || e.isHidden) ? this.removeNode(e) : e.updateChildIndices();
		for (let e of this.dirtyNodes) e instanceof Os ? (e.isConnected && !e.isHidden && (e.updateNode(), this.addNode(e)), e.node && this.dirtyNodes.delete(e), e.isMutated = !1) : this.dirtyNodes.delete(e);
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/collections/useCachedChildren.mjs
function As(e) {
	let { children: t, items: n, idScope: r, addIdAndValue: i, dependencies: a = [] } = e, o = (0, _.useMemo)(() => void 0, [t]), s = (0, _.useMemo)(() => /* @__PURE__ */ new WeakMap(), [...a, o]);
	return (0, _.useMemo)(() => {
		if (n && typeof t == "function") {
			let e = [];
			for (let a of n) {
				let n = js(a) ? a : null, o = n ? s.get(n) : null;
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
function js(e) {
	switch (typeof e) {
		case "object": return e != null;
		case "function":
		case "symbol": return !0;
		default: return !1;
	}
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/use-sync-external-store/cjs/use-sync-external-store-shim.production.js
var Ms = /* @__PURE__ */ o(((e) => {
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
})), Ns = (/* @__PURE__ */ o(((e, t) => {
	t.exports = Ms();
})))(), Ps = /*#__PURE__*/ (0, _.createContext)(!1), Fs = /*#__PURE__*/ (0, _.createContext)(null);
function Is(e) {
	if ((0, _.useContext)(Fs)) return e.content;
	let { collection: t, document: n } = Bs(e.createCollection);
	return /*#__PURE__*/ _.createElement(_.Fragment, null, /*#__PURE__*/ _.createElement(mi, null, /*#__PURE__*/ _.createElement(Fs.Provider, { value: n }, e.content)), /*#__PURE__*/ _.createElement(Ls, {
		render: e.children,
		collection: t
	}));
}
function Ls({ collection: e, render: t }) {
	return t(e);
}
function Rs(e, t, n) {
	let r = Ur(), i = (0, _.useRef)(r);
	i.current = r;
	let a = (0, _.useCallback)(() => i.current ? n() : t(), [t, n]);
	return (0, Ns.useSyncExternalStore)(e, a);
}
var zs = typeof _.useSyncExternalStore == "function" ? _.useSyncExternalStore : Rs;
function Bs(e) {
	let [t] = (0, _.useState)(() => new ks(e?.() || new Ts()));
	return {
		collection: zs((0, _.useCallback)((e) => t.subscribe(e), [t]), (0, _.useCallback)(() => {
			let e = t.getCollection();
			return t.isSSR && t.resetAfterSSR(), e;
		}, [t]), (0, _.useCallback)(() => (t.isSSR = !0, t.getCollection()), [t])),
		document: t
	};
}
var Vs = /*#__PURE__*/ (0, _.createContext)(null);
function Hs(e) {
	return class extends ys {
		static {
			this.type = e;
		}
	};
}
function Us(e, t, n, r, i, a) {
	typeof e == "string" && (e = Hs(e));
	let o = (0, _.useCallback)((i) => {
		i?.setProps(t, n, e, r, a);
	}, [
		t,
		n,
		r,
		a,
		e
	]), s = (0, _.useContext)(Vs);
	if (s) {
		let o = s.ownerDocument.nodesByProps.get(t);
		return o || (o = s.ownerDocument.createElement(e.type), o.setProps(t, n, e, r, a), s.appendChild(o), s.ownerDocument.updateCollection(), s.ownerDocument.nodesByProps.set(t, o)), i ? /*#__PURE__*/ _.createElement(Vs.Provider, { value: o }, i) : null;
	}
	return /*#__PURE__*/ _.createElement(e.type, { ref: o }, i);
}
function Ws(e, t) {
	let n = ({ node: e }) => t(e.props, e.props.ref, e), r = (0, _.forwardRef)((r, i) => {
		let a = (0, _.useContext)(Mo);
		if (!(0, _.useContext)(Ps)) {
			if (t.length >= 3) throw Error(t.name + " cannot be rendered outside a collection.");
			return t(r, i);
		}
		return Us(e, r, i, "children" in r ? r.children : null, null, (e) => /*#__PURE__*/ _.createElement(Mo.Provider, { value: a }, /*#__PURE__*/ _.createElement(n, { node: e })));
	});
	return r.displayName = t.name, r;
}
function Gs(e, t, n = Ks) {
	let r = ({ node: e }) => t(e.props, e.props.ref, e), i = (0, _.forwardRef)((t, i) => Us(e, t, i, null, n(t), (e) => /*#__PURE__*/ _.createElement(r, { node: e })) ?? /*#__PURE__*/ _.createElement(_.Fragment, null));
	return i.displayName = t.name, i;
}
function Ks(e) {
	return As({
		...e,
		addIdAndValue: !0
	});
}
var qs = /*#__PURE__*/ (0, _.createContext)(null);
function Js(e) {
	let t = (0, _.useContext)(qs), n = (t?.dependencies || []).concat(e.dependencies), r = e.idScope ?? t?.idScope, i = Ks({
		...e,
		idScope: r,
		dependencies: n
	});
	return (0, _.useContext)(Fs) && (i = /*#__PURE__*/ _.createElement(Ys, null, i)), t = (0, _.useMemo)(() => ({
		dependencies: n,
		idScope: r
	}), [r, ...n]), /*#__PURE__*/ _.createElement(qs.Provider, { value: t }, i);
}
function Ys({ children: e }) {
	let t = (0, _.useContext)(Fs), n = (0, _.useMemo)(() => /*#__PURE__*/ _.createElement(Fs.Provider, { value: null }, /*#__PURE__*/ _.createElement(Ps.Provider, { value: !0 }, e)), [e]);
	return Ur() ? /*#__PURE__*/ _.createElement(Vs.Provider, { value: t }, n) : /*#__PURE__*/ (0, Ko.createPortal)(n, t);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria-components/dist/private/Collection.mjs
var Xs = /*#__PURE__*/ (0, _.createContext)(null), Zs = {
	CollectionRoot({ collection: e, renderDropIndicator: t }) {
		return Qs(e, null, t);
	},
	CollectionBranch({ collection: e, parent: t, renderDropIndicator: n }) {
		return Qs(e, t, n);
	}
};
function Qs(e, t, n) {
	return As({
		items: t ? e.getChildren(t.key) : e,
		dependencies: [n],
		children(t) {
			if (t.type === "content") return /*#__PURE__*/ _.createElement(_.Fragment, null);
			let r = t.render(t);
			return !n || t.type !== "item" ? r : /*#__PURE__*/ _.createElement(_.Fragment, null, n({
				type: "item",
				key: t.key,
				dropPosition: "before"
			}), r, $s(e, t, n));
		}
	});
}
function $s(e, t, n) {
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
var ec = /*#__PURE__*/ (0, _.createContext)(Zs);
function tc(e) {
	return (0, _.useMemo)(() => e == null ? null : /* @__PURE__ */ new Set([e]), [e]);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/constants.mjs
var nc = "react-aria-clear-focus", rc = "react-aria-focus";
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/focus/virtualFocus.mjs
function ic(e) {
	let t = sc(F(e));
	t !== e && (t && ac(t, e), e && oc(e, t));
}
function ac(e, t) {
	e.dispatchEvent(new FocusEvent("blur", { relatedTarget: t })), e.dispatchEvent(new FocusEvent("focusout", {
		bubbles: !0,
		relatedTarget: t
	}));
}
function oc(e, t) {
	e.dispatchEvent(new FocusEvent("focus", { relatedTarget: t })), e.dispatchEvent(new FocusEvent("focusin", {
		bubbles: !0,
		relatedTarget: t
	}));
}
function sc(e) {
	let t = na(e), n = t?.getAttribute("aria-activedescendant");
	return n && e.getElementById(n) || t;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/keyboard.mjs
function cc(e) {
	return Sa() ? e.metaKey : e.ctrlKey;
}
var lc = /* @__PURE__ */ new Set([
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
function uc(e) {
	return e instanceof HTMLInputElement && !lc.has(e.type) || e instanceof HTMLTextAreaElement || e instanceof HTMLElement && e.isContentEditable;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useEvent.mjs
function dc(e, t, n, r) {
	let i = z(n), a = n == null;
	(0, _.useEffect)(() => {
		if (!(a || e.current == null)) return Qi(e.current, t, i, r);
	}, [
		e,
		t,
		r,
		a
	]);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/@internationalized/string/dist/private/LocalizedStringDictionary.mjs
var fc = Symbol.for("react-aria.i18n.locale"), pc = Symbol.for("react-aria.i18n.strings"), mc = void 0, hc = class e {
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
		return t || (t = gc(e, this.strings, this.defaultLocale), this.strings[e] = t), t;
	}
	static getGlobalDictionaryForPackage(t) {
		if (typeof window > "u") return null;
		let n = window[fc];
		if (mc === void 0) {
			let t = window[pc];
			if (!t) return null;
			mc = {};
			for (let r in t) mc[r] = new e({ [n]: t[r] }, n);
		}
		let r = mc?.[t];
		if (!r) throw Error(`Strings for package "${t}" were not included by LocalizedStringProvider. Please add it to the list passed to createLocalizedStringDictionary.`);
		return r;
	}
};
function gc(e, t, n = "en-US") {
	if (t[e]) return t[e];
	let r = _c(e), i = vc(e);
	if (i && t[`${r}-${i}`]) return t[`${r}-${i}`];
	if (t[r]) return t[r];
	for (let e in t) if (e.startsWith(r + "-")) return t[e];
	return t[n];
}
function _c(e) {
	return Intl.Locale ? new Intl.Locale(e).language : e.split("-")[0];
}
function vc(e) {
	if (Intl.Locale) return new Intl.Locale(e).script;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/@internationalized/string/dist/private/LocalizedStringFormatter.mjs
var yc = /* @__PURE__ */ new Map(), bc = /* @__PURE__ */ new Map(), xc = class {
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
		let i = this.locale + ":" + n, a = yc.get(i);
		return a || (a = new Intl.PluralRules(this.locale, { type: n }), yc.set(i, a)), r = t[a.select(e)] || t.other, typeof r == "function" ? r() : r;
	}
	number(e) {
		let t = bc.get(this.locale);
		return t || (t = new Intl.NumberFormat(this.locale), bc.set(this.locale, t)), t.format(e);
	}
	select(e, t) {
		let n = e[t] || e.other;
		return typeof n == "function" ? n() : n;
	}
}, Sc = /* @__PURE__ */ new WeakMap();
function Cc(e) {
	let t = Sc.get(e);
	return t || (t = new hc(e), Sc.set(e, t)), t;
}
function wc(e, t) {
	return t && hc.getGlobalDictionaryForPackage(t) || Cc(e);
}
function Tc(e, t) {
	let { locale: n } = Fi(), r = wc(e, t);
	return (0, _.useMemo)(() => new xc(n, r), [n, r]);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/utils/useControlledState.mjs
var Ec = typeof document < "u" ? _.useInsertionEffect ?? _.useLayoutEffect : () => {};
function Dc(e, t, n) {
	let [r, i] = (0, _.useState)(e || t), a = (0, _.useRef)(r), o = (0, _.useRef)(e !== void 0), s = e !== void 0;
	(0, _.useEffect)(() => {
		o.current, o.current = s;
	}, [s]);
	let c = s ? e : r;
	Ec(() => {
		a.current = c;
	});
	let [, l] = (0, _.useReducer)(() => ({}), {});
	return [c, (0, _.useCallback)((e, ...t) => {
		let r = typeof e == "function" ? e(a.current) : e;
		Object.is(a.current, r) || (a.current = r, i(r), l(), n?.(r, ...t));
	}, [n])];
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria-components/dist/private/Autocomplete.mjs
var Oc = /*#__PURE__*/ (0, _.createContext)(null), kc = /*#__PURE__*/ (0, _.createContext)(null), Ac = /*#__PURE__*/ (0, _.createContext)({}), jc = /*#__PURE__*/ Ws(xs, function(e, t) {
	return [e, t] = ci(e, t, Ac), /*#__PURE__*/ _.createElement(fi.header, {
		className: "react-aria-Header",
		...e,
		ref: t
	}, e.children);
}), Mc = /*#__PURE__*/ (0, _.createContext)({}), Nc = /*#__PURE__*/ (0, _.createContext)({ placement: "bottom" }), Pc = class {
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
		if (!I(this.root, e)) throw Error("Cannot set currentNode to a node that is not contained by the root node.");
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
		return I(e, t) ? (t && (this.currentNode = t), t) : (this.currentNode = e, null);
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
function Fc(e, t, n, r) {
	return ta() ? new Pc(e, t, n, r) : e.createTreeWalker(t, n, r);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/ariaHideOutside.mjs
var Ic = typeof HTMLElement < "u" && "inert" in HTMLElement.prototype;
function Lc(e) {
	return e.dataset.liveAnnouncer === "true" || e.dataset.reactAriaTopLayer !== void 0;
}
var Rc = /* @__PURE__ */ new WeakMap(), zc = [];
function Bc(e, t) {
	let n = qi(e?.[0]), r = t instanceof n.Element ? { root: t } : t, i = r?.root ?? document.body, a = r?.shouldUseInert && Ic, o = new Set(e), s = /* @__PURE__ */ new Set(), c = (e) => a && e instanceof n.HTMLElement ? e.inert : e.getAttribute("aria-hidden") === "true", l = (e, t) => {
		a && e instanceof n.HTMLElement ? e.inert = t : t ? e.setAttribute("aria-hidden", "true") : (e.removeAttribute("aria-hidden"), e instanceof n.HTMLElement && (e.inert = !1));
	}, u = /* @__PURE__ */ new Set();
	if (ta()) {
		let t = i.getRootNode();
		for (let n of e) {
			let e = n.getRootNode();
			for (; Zi(e) && e !== t;) u.add(e), e = e.host.getRootNode();
		}
	}
	let d = (e) => {
		for (let t of e.querySelectorAll("[data-live-announcer], [data-react-aria-top-layer]")) o.add(t);
		let t = (e) => {
			if (s.has(e) || o.has(e) || e.parentElement && s.has(e.parentElement) && e.parentElement.getAttribute("role") !== "row") return NodeFilter.FILTER_REJECT;
			for (let t of o) if (I(e, t)) return NodeFilter.FILTER_SKIP;
			return NodeFilter.FILTER_ACCEPT;
		}, n = Fc(F(e), e, NodeFilter.SHOW_ELEMENT, { acceptNode: t }), r = t(e);
		if (r === NodeFilter.FILTER_ACCEPT && f(e), r !== NodeFilter.FILTER_REJECT) {
			let e = n.nextNode();
			for (; e != null;) f(e), e = n.nextNode();
		}
	}, f = (e) => {
		let t = Rc.get(e) ?? 0;
		c(e) && t === 0 || (t === 0 && l(e, !0), s.add(e), Rc.set(e, t + 1));
	};
	zc.length && zc[zc.length - 1].disconnect(), d(i);
	let p = new MutationObserver((e) => {
		for (let t of e) if (t.type === "childList") {
			if (t.target.isConnected && ![...o, ...s].some((e) => I(e, t.target))) for (let e of t.addedNodes) (e instanceof HTMLElement || e instanceof SVGElement) && Lc(e) ? o.add(e) : e instanceof Element && d(e);
			if (ta()) {
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
	if (ta()) for (let e of u) {
		let t = new MutationObserver((e) => {
			for (let t of e) if (t.type === "childList") {
				if (t.target.isConnected && ![...o, ...s].some((e) => I(e, t.target))) for (let e of t.addedNodes) (e instanceof HTMLElement || e instanceof SVGElement) && Lc(e) ? o.add(e) : e instanceof Element && d(e);
				if (ta()) {
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
	return zc.push(h), () => {
		if (p.disconnect(), ta()) for (let e of m) e.disconnect();
		for (let e of s) {
			let t = Rc.get(e);
			t != null && (t === 1 ? (l(e, !1), Rc.delete(e)) : Rc.set(e, t - 1));
		}
		h === zc[zc.length - 1] ? (zc.pop(), zc.length && zc[zc.length - 1].observe()) : zc.splice(zc.indexOf(h), 1);
	};
}
function Vc(e) {
	let t = zc[zc.length - 1];
	if (t && !t.visibleNodes.has(e)) return t.visibleNodes.add(e), () => {
		t.visibleNodes.delete(e);
	};
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/calculatePosition.mjs
var Hc = {
	top: "top",
	bottom: "top",
	left: "left",
	right: "left"
}, Uc = {
	top: "bottom",
	bottom: "top",
	left: "right",
	right: "left"
}, Wc = {
	top: "left",
	left: "top"
}, Gc = {
	top: "height",
	left: "width"
}, Kc = {
	width: "totalWidth",
	height: "totalHeight"
}, qc = {}, Jc = () => typeof document < "u" ? window.visualViewport : null;
function Yc(e, t) {
	let n = 0, r = 0, i = 0, a = 0, o = 0, s = 0, c = {}, l = (t?.scale ?? 1) > 1;
	if (e.tagName === "BODY" || e.tagName === "HTML") {
		let l = document.documentElement;
		i = l.clientWidth, a = l.clientHeight, n = t?.width ?? i, r = t?.height ?? a, c.top = l.scrollTop || e.scrollTop, c.left = l.scrollLeft || e.scrollLeft, t && (o = Math.max(0, t.pageTop - (c.top ?? 0)), s = Math.max(0, t.pageLeft - (c.left ?? 0)));
	} else ({width: n, height: r, top: o, left: s} = ol(e, !1)), c.top = e.scrollTop, c.left = e.scrollLeft, i = n, a = r;
	return Da() && (e.tagName === "BODY" || e.tagName === "HTML") && l && (c.top = 0, c.left = 0, o = t?.pageTop ?? 0, s = t?.pageLeft ?? 0), {
		width: n,
		height: r,
		totalWidth: i,
		totalHeight: a,
		scroll: c,
		top: o,
		left: s
	};
}
function Xc(e) {
	return {
		top: e.scrollTop,
		left: e.scrollLeft,
		width: e.scrollWidth,
		height: e.scrollHeight
	};
}
function Zc(e, t, n, r, i, a, o) {
	let s = i.scroll[e] ?? 0, c = r[Gc[e]], l = o[e] + r.scroll[Hc[e]] + a, u = o[e] + r.scroll[Hc[e]] + c - a, d = t - s + r.scroll[Hc[e]] + o[e] - r[Hc[e]], f = t - s + n + r.scroll[Hc[e]] + o[e] - r[Hc[e]];
	return d < l ? l - d : f > u ? Math.max(u - f, l - d) : 0;
}
function Qc(e) {
	let t = window.getComputedStyle(e);
	return {
		top: parseInt(t.marginTop, 10) || 0,
		bottom: parseInt(t.marginBottom, 10) || 0,
		left: parseInt(t.marginLeft, 10) || 0,
		right: parseInt(t.marginRight, 10) || 0
	};
}
function $c(e) {
	if (qc[e]) return qc[e];
	let [t, n] = e.split(" "), r = Hc[t] || "right", i = Wc[r];
	Hc[n] || (n = "center");
	let a = Gc[r], o = Gc[i];
	return qc[e] = {
		placement: t,
		crossPlacement: n,
		axis: r,
		crossAxis: i,
		size: a,
		crossSize: o
	}, qc[e];
}
function el(e, t, n, r, i, a, o, s, c, l, u) {
	let { placement: d, crossPlacement: f, axis: p, crossAxis: m, size: h, crossSize: g } = r, _ = {};
	_[m] = e[m] ?? 0, f === "center" ? _[m] += ((e[g] ?? 0) - (n[g] ?? 0)) / 2 : f !== m && (_[m] += (e[g] ?? 0) - (n[g] ?? 0)), _[m] += a;
	let v = e[m] - n[g] + c + l, y = e[m] + e[g] - c - l;
	if (_[m] = Ii(_[m], v, y), d === p) {
		let t = s ? u[h] : u[Kc[h]];
		_[Uc[p]] = Math.floor(t - e[p] + i);
	} else _[p] = Math.floor(e[p] + e[h] + i);
	return _;
}
function tl(e, t, n, r, i, a, o, s, c, l, u) {
	let d = (e.top == null ? c[Kc.height] - (e.bottom ?? 0) - o : e.top) - (c.scroll.top ?? 0), f = l ? n.top : 0, p = {
		top: Math.max(t.top + f, (u?.offsetTop ?? t.top) + f),
		bottom: Math.min(t.top + t.height + f, (u?.offsetTop ?? 0) + (u?.height ?? 0))
	};
	return s === "top" ? Math.max(0, d + o - p.top - ((i.top ?? 0) + (i.bottom ?? 0) + a)) : Math.max(0, p.bottom - d - ((i.top ?? 0) + (i.bottom ?? 0) + a));
}
function nl(e, t, n, r, i, a, o, s) {
	let { placement: c, axis: l, size: u } = a;
	return c === l ? Math.max(0, n[l] - (o.scroll[l] ?? 0) - (e[l] + (s ? t[l] : 0)) - (r[l] ?? 0) - r[Uc[l]] - i) : Math.max(0, e[u] + e[l] + (s ? t[l] : 0) - n[l] - n[u] + (o.scroll[l] ?? 0) - (r[l] ?? 0) - r[Uc[l]] - i);
}
function rl(e, t, n, r, i, a, o, s, c, l, u, d, f, p, m, h, g, _) {
	let v = $c(e), { size: y, crossAxis: b, crossSize: x, placement: S, crossPlacement: C } = v, w = el(t, s, n, v, u, d, l, f, m, h, c), T = u, ee = nl(s, l, t, i, a + u, v, c, g);
	if (o && n[y] > ee) {
		let e = $c(`${Uc[S]} ${C}`), r = el(t, s, n, e, u, d, l, f, m, h, c);
		nl(s, l, t, i, a + u, e, c, g) > ee && (v = e, w = r, T = u);
	}
	let E = "bottom";
	v.axis === "top" ? v.placement === "top" ? E = "top" : v.placement === "bottom" && (E = "bottom") : v.crossAxis === "top" && (v.crossPlacement === "top" ? E = "bottom" : v.crossPlacement === "bottom" && (E = "top"));
	let te = Zc(b, w[b], n[x], s, c, a, l);
	w[b] += te;
	let ne = tl(w, s, l, f, i, a, n.height, E, c, g, _);
	p && p < ne && (ne = p), n.height = Math.min(n.height, ne), w = el(t, s, n, v, T, d, l, f, m, h, c), te = Zc(b, w[b], n[x], s, c, a, l), w[b] += te;
	let D = {}, re = t[b] - w[b] - i[Hc[b]], ie = re + .5 * t[x], ae = m / 2 + h, oe = Hc[b] === "left" ? (i.left ?? 0) + (i.right ?? 0) : (i.top ?? 0) + (i.bottom ?? 0), se = n[x] - oe - m / 2 - h;
	D[b] = Ii(Ii(ie, t[b] + m / 2 - (w[b] + i[Hc[b]]), t[b] + t[x] - m / 2 - (w[b] + i[Hc[b]])), ae, se), {placement: S, crossPlacement: C} = v, m ? re = D[b] : C === "right" ? re += t[x] : C === "center" && (re += t[x] / 2);
	let ce = S === "left" || S === "top" ? n[y] : 0, le = {
		x: S === "top" || S === "bottom" ? re : ce,
		y: S === "left" || S === "right" ? re : ce
	};
	return {
		position: w,
		maxHeight: ne,
		arrowOffsetLeft: D.left,
		arrowOffsetTop: D.top,
		placement: S,
		triggerAnchorPoint: le
	};
}
function il(e) {
	let { placement: t, targetNode: n, overlayNode: r, scrollNode: i, padding: a, shouldFlip: o, boundaryElement: s, offset: c, crossOffset: l, maxHeight: u, arrowSize: d = 0, arrowBoundaryOffset: f = 0, targetRect: p } = e, m = Jc(), h = r instanceof HTMLElement ? cl(r) : document.documentElement, g = h === document.documentElement, _ = window.getComputedStyle(h).position, v = !!_ && _ !== "static", y = g ? ol(n, !1, p) : sl(n, h, !1, p);
	if (!g) {
		let { marginTop: e, marginLeft: t } = window.getComputedStyle(n);
		y.top += parseInt(e, 10) || 0, y.left += parseInt(t, 10) || 0;
	}
	let b = ol(r, !0), x = Qc(r);
	b.width += (x.left ?? 0) + (x.right ?? 0), b.height += (x.top ?? 0) + (x.bottom ?? 0);
	let S = Xc(i), C = Yc(s, m), w = Yc(h, m), T;
	if ((s.tagName === "BODY" || s.tagName === "HTML") && !g) {
		let e = al(h, !1);
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
	} : sl(s, h, !1);
	let ee = I(s, h);
	return rl(t, y, b, S, x, a, o, C, w, T, c, l, v, u, d, f, ee, m);
}
function al(e, t) {
	let { top: n, left: r, width: i, height: a } = e.getBoundingClientRect();
	return t && e instanceof e.ownerDocument.defaultView.HTMLElement && (i = e.offsetWidth, a = e.offsetHeight), {
		top: n,
		left: r,
		width: i,
		height: a
	};
}
function ol(e, t, n) {
	let { top: r, left: i, width: a, height: o } = n || al(e, t), { scrollTop: s, scrollLeft: c, clientTop: l, clientLeft: u } = document.documentElement;
	return {
		top: r + s - l,
		left: i + c - u,
		width: a,
		height: o
	};
}
function sl(e, t, n, r) {
	let i = window.getComputedStyle(e), a;
	if (i.position === "fixed") a = r || al(e, n);
	else {
		a = ol(e, n, r);
		let i = ol(t, n), o = window.getComputedStyle(t);
		i.top += (parseInt(o.borderTopWidth, 10) || 0) - t.scrollTop, i.left += (parseInt(o.borderLeftWidth, 10) || 0) - t.scrollLeft, a.top -= i.top, a.left -= i.left;
	}
	return a.top -= parseInt(i.marginTop, 10) || 0, a.left -= parseInt(i.marginLeft, 10) || 0, a;
}
function cl(e) {
	let t = e.offsetParent;
	if (t && t === document.body && window.getComputedStyle(t).position === "static" && !ll(t) && (t = document.documentElement), t == null) for (t = e.parentElement; t && !ll(t);) t = t.parentElement;
	return t || document.documentElement;
}
function ll(e) {
	let t = window.getComputedStyle(e);
	return t.transform !== "none" || /transform|perspective/.test(t.willChange) || t.filter !== "none" || t.contain === "paint" || "backdropFilter" in t && t.backdropFilter !== "none" || "WebkitBackdropFilter" in t && t.WebkitBackdropFilter !== "none";
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/useCloseOnScroll.mjs
var ul = /* @__PURE__ */ new WeakMap();
function dl(e) {
	let { triggerRef: t, isOpen: n, onClose: r } = e;
	(0, _.useEffect)(() => !n || r === null ? void 0 : Qi(ra(t.current), "scroll", (e) => {
		let n = L(e);
		if (!t.current || n instanceof Node && !I(n, t.current) || n instanceof HTMLInputElement || n instanceof HTMLTextAreaElement) return;
		let i = r || ul.get(t.current);
		i && i();
	}, !0), [
		n,
		r,
		t
	]);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useResizeObserver.mjs
function fl() {
	return window.ResizeObserver !== void 0;
}
function pl(e) {
	let { ref: t, box: n, onResize: r } = e, i = z(r);
	(0, _.useEffect)(() => {
		let e = t?.current;
		if (e) {
			if (fl()) {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/useOverlayPosition.mjs
var ml = typeof document < "u" ? window.visualViewport : null;
function hl(e) {
	let { direction: t } = Fi(), { arrowSize: n, targetRef: r, overlayRef: i, arrowRef: a, scrollRef: o = i, placement: s = "bottom", containerPadding: c = 12, shouldFlip: l = !0, boundaryElement: u = typeof document < "u" ? document.body : null, offset: d = 0, crossOffset: f = 0, shouldUpdatePosition: p = !0, isOpen: m = !0, onClose: h, maxHeight: g, arrowBoundaryOffset: v = 0, getTargetRect: y } = e, [b, x] = (0, _.useState)(null), S = [
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
	], C = (0, _.useRef)(ml?.scale);
	(0, _.useEffect)(() => {
		m && (C.current = ml?.scale);
	}, [m]);
	let w = (0, _.useCallback)(() => {
		if (p === !1 || !m || !i.current || !r.current || !u || ml?.scale !== C.current) return;
		let e = null;
		if (o.current && ia(o.current)) {
			let t = na()?.getBoundingClientRect(), n = o.current.getBoundingClientRect();
			e = {
				type: "top",
				offset: (t?.top ?? 0) - n.top
			}, e.offset > n.height / 2 && (e.type = "bottom", e.offset = (t?.bottom ?? 0) - n.bottom);
		}
		let h = i.current;
		!g && i.current && (h.style.top = "0px", h.style.bottom = "", h.style.maxHeight = (window.visualViewport?.height ?? window.innerHeight) + "px");
		let _ = il({
			placement: _l(s, t),
			overlayNode: i.current,
			targetNode: r.current,
			scrollNode: o.current || i.current,
			padding: c,
			shouldFlip: l,
			boundaryElement: u,
			offset: d,
			crossOffset: f,
			maxHeight: g,
			arrowSize: n ?? (a?.current ? al(a.current, !0).width : 0),
			arrowBoundaryOffset: v,
			targetRect: y?.(r.current)
		});
		if (!_.position) return;
		h.style.top = "", h.style.bottom = "", h.style.left = "", h.style.right = "", Object.keys(_.position).forEach((e) => h.style[e] = _.position[e] + "px"), h.style.maxHeight = _.maxHeight == null ? "" : _.maxHeight + "px";
		let b = na();
		if (e && b && o.current) {
			let t = b.getBoundingClientRect(), n = o.current.getBoundingClientRect(), r = t[e.type] - n[e.type];
			o.current.scrollTop += r - e.offset;
		}
		x(_);
	}, S);
	P(w, S), gl(w), pl({
		ref: i,
		onResize: w
	}), pl({
		ref: r,
		onResize: w
	});
	let T = (0, _.useRef)(!1);
	P(() => {
		let e, t = () => {
			T.current = !0, clearTimeout(e), e = setTimeout(() => {
				T.current = !1;
			}, 500), w();
		}, n = () => {
			T.current && t();
		};
		ml?.addEventListener("resize", t), ml?.addEventListener("scroll", n);
		let r = Qi(ra(window), "scroll", n);
		return () => {
			ml?.removeEventListener("resize", t), ml?.removeEventListener("scroll", n), r();
		};
	}, [w]);
	let ee = (0, _.useCallback)(() => {
		T.current || h?.();
	}, [h, T]);
	return dl({
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
function gl(e) {
	P(() => (window.addEventListener("resize", e, !1), () => {
		window.removeEventListener("resize", e, !1);
	}), [e]);
}
function _l(e, t) {
	return t === "rtl" ? e.replace("start", "right").replace("end", "left") : e.replace("start", "left").replace("end", "right");
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/focus/FocusScope.mjs
var vl = /*#__PURE__*/ _.createContext(null), yl = "react-aria-focus-scope-restore", bl = null;
function xl(e) {
	let { children: t, contain: n, restoreFocus: r, autoFocus: i } = e, a = (0, _.useRef)(null), o = (0, _.useRef)(null), s = (0, _.useRef)([]), { parentNode: c } = (0, _.useContext)(vl) || {}, l = (0, _.useMemo)(() => new Ul({ scopeRef: s }), [s]);
	P(() => {
		let e = c || Wl.root;
		if (Wl.getTreeNode(e.scopeRef) && bl && !Ml(bl, e.scopeRef)) {
			let t = Wl.getTreeNode(bl);
			t && (e = t);
		}
		e.addChild(l), Wl.addNode(l);
	}, [l, c]), P(() => {
		let e = Wl.getTreeNode(s);
		e && (e.contain = !!n);
	}, [n]), P(() => {
		let e = a.current?.nextSibling, t = [], n = (e) => e.stopPropagation();
		for (; e && e !== o.current;) t.push(e), e.addEventListener(yl, n), e = e.nextSibling;
		return s.current = t, () => {
			for (let e of t) e.removeEventListener(yl, n);
		};
	}, [t]), Ll(s, r, n), Dl(s, n), zl(s, r, n), Il(s, i), (0, _.useEffect)(() => {
		let e = na(F(s.current ? s.current[0] : void 0)), t = null;
		if (kl(e, s.current)) {
			for (let n of Wl.traverse()) n.scopeRef && kl(e, n.scopeRef.current) && (t = n);
			t === Wl.getTreeNode(s) && (bl = t.scopeRef);
		}
	}, [s]), P(() => () => {
		let e = Wl.getTreeNode(s)?.parent?.scopeRef ?? null;
		(s === bl || Ml(s, bl)) && (!e || Wl.getTreeNode(e)) && (bl = e), Wl.removeTreeNode(s);
	}, [s]);
	let u = (0, _.useMemo)(() => Sl(s), []), d = (0, _.useMemo)(() => ({
		focusManager: u,
		parentNode: l
	}), [l, u]);
	return /*#__PURE__*/ _.createElement(vl.Provider, { value: d }, /*#__PURE__*/ _.createElement("span", {
		"data-focus-scope-start": !0,
		hidden: !0,
		ref: a
	}), t, /*#__PURE__*/ _.createElement("span", {
		"data-focus-scope-end": !0,
		hidden: !0,
		ref: o
	}));
}
function Sl(e) {
	return {
		focusNext(t = {}) {
			let n = e.current, { from: r, tabbable: i, wrap: a, accept: o } = t, s = r || na(F(n[0] ?? void 0)), c = n[0].previousElementSibling, l = Vl(Cl(n), {
				tabbable: i,
				accept: o
			}, n);
			l.currentNode = kl(s, n) ? s : c;
			let u = l.nextNode();
			return !u && a && (l.currentNode = c, u = l.nextNode()), u && Nl(u, !0), u;
		},
		focusPrevious(t = {}) {
			let n = e.current, { from: r, tabbable: i, wrap: a, accept: o } = t, s = r || na(F(n[0] ?? void 0)), c = n[n.length - 1].nextElementSibling, l = Vl(Cl(n), {
				tabbable: i,
				accept: o
			}, n);
			l.currentNode = kl(s, n) ? s : c;
			let u = l.previousNode();
			return !u && a && (l.currentNode = c, u = l.previousNode()), u && Nl(u, !0), u;
		},
		focusFirst(t = {}) {
			let n = e.current, { tabbable: r, accept: i } = t, a = Vl(Cl(n), {
				tabbable: r,
				accept: i
			}, n);
			a.currentNode = n[0].previousElementSibling;
			let o = a.nextNode();
			return o && Nl(o, !0), o;
		},
		focusLast(t = {}) {
			let n = e.current, { tabbable: r, accept: i } = t, a = Vl(Cl(n), {
				tabbable: r,
				accept: i
			}, n);
			a.currentNode = n[n.length - 1].nextElementSibling;
			let o = a.previousNode();
			return o && Nl(o, !0), o;
		}
	};
}
function Cl(e) {
	return e[0].parentElement;
}
function wl(e) {
	let t = Wl.getTreeNode(bl);
	for (; t && t.scopeRef !== e;) {
		if (t.contain) return !1;
		t = t.parent;
	}
	return !0;
}
function Tl(e) {
	if (!e.form) return Array.from(F(e).querySelectorAll(`input[type="radio"][name="${CSS.escape(e.name)}"]`)).filter((e) => !e.form);
	let t = e.form.elements.namedItem(e.name), n = qi(e);
	return t instanceof n.RadioNodeList ? Array.from(t).filter((e) => e instanceof n.HTMLInputElement) : t instanceof n.HTMLInputElement ? [t] : [];
}
function El(e) {
	if (e.checked) return !0;
	let t = Tl(e);
	return t.length > 0 && !t.some((e) => e.checked);
}
function Dl(e, t) {
	let n = (0, _.useRef)(void 0), r = (0, _.useRef)(void 0);
	P(() => {
		let i = e.current;
		if (!t) {
			r.current &&= (cancelAnimationFrame(r.current), void 0);
			return;
		}
		let a = F(i ? i[0] : void 0), o = (t) => {
			if (t.key !== "Tab" || t.altKey || t.ctrlKey || t.metaKey || !wl(e) || t.isComposing) return;
			let n = na(a), r = e.current;
			if (!r || !kl(n, r)) return;
			let i = Vl(Cl(r), { tabbable: !0 }, r);
			if (!n) return;
			i.currentNode = n;
			let o = t.shiftKey ? i.previousNode() : i.nextNode();
			o ||= (i.currentNode = t.shiftKey ? r[r.length - 1].nextElementSibling : r[0].previousElementSibling, t.shiftKey ? i.previousNode() : i.nextNode()), t.preventDefault(), o && (Nl(o, !0), o instanceof qi(o).HTMLInputElement && o.select());
		}, s = (t) => {
			(!bl || Ml(bl, e)) && kl(L(t), e.current) ? (bl = e, n.current = L(t)) : wl(e) && !Al(L(t), e) ? n.current ? Nl(n.current) : bl && bl.current && Fl(bl.current) : wl(e) && (n.current = L(t));
		}, c = (t) => {
			r.current && cancelAnimationFrame(r.current), r.current = requestAnimationFrame(() => {
				let r = io(), i = (r === "virtual" || r === null) && ka() && Oa(), o = na(a);
				if (!i && o && wl(e) && !Al(o, e)) {
					bl = e;
					let r = L(t);
					r && r.isConnected ? (n.current = r, Nl(n.current)) : bl.current && Fl(bl.current);
				}
			});
		};
		return a.addEventListener("keydown", o, !1), a.addEventListener("focusin", s, !1), i?.forEach((e) => e.addEventListener("focusin", s, !1)), i?.forEach((e) => e.addEventListener("focusout", c, !1)), () => {
			a.removeEventListener("keydown", o, !1), a.removeEventListener("focusin", s, !1), i?.forEach((e) => e.removeEventListener("focusin", s, !1)), i?.forEach((e) => e.removeEventListener("focusout", c, !1));
		};
	}, [e, t]), P(() => () => {
		r.current && cancelAnimationFrame(r.current);
	}, [r]);
}
function Ol(e) {
	return Al(e);
}
function kl(e, t) {
	return !e || !t ? !1 : t.some((t) => I(t, e));
}
function Al(e, t = null) {
	if (e instanceof Element && e.closest("[data-react-aria-top-layer]")) return !0;
	for (let { scopeRef: n } of Wl.traverse(Wl.getTreeNode(t))) if (n && kl(e, n.current)) return !0;
	return !1;
}
function jl(e) {
	return Al(e, bl);
}
function Ml(e, t) {
	let n = Wl.getTreeNode(t)?.parent;
	for (; n;) {
		if (n.scopeRef === e) return !0;
		n = n.parent;
	}
	return !1;
}
function Nl(e, t = !1) {
	if (e != null && !t) try {
		ho(e);
	} catch {}
	else if (e != null) try {
		e.focus();
	} catch {}
}
function Pl(e, t = !0) {
	let n = e[0].previousElementSibling, r = Cl(e), i = Vl(r, { tabbable: t }, e);
	i.currentNode = n;
	let a = i.nextNode();
	return t && !a && (r = Cl(e), i = Vl(r, { tabbable: !1 }, e), i.currentNode = n, a = i.nextNode()), a;
}
function Fl(e, t = !0) {
	Nl(Pl(e, t));
}
function Il(e, t) {
	let n = _.useRef(t);
	(0, _.useEffect)(() => {
		n.current && (bl = e, !kl(na(F(e.current ? e.current[0] : void 0)), bl.current) && e.current && Fl(e.current)), n.current = !1;
	}, [e]);
}
function Ll(e, t, n) {
	P(() => {
		if (t || n) return;
		let r = e.current, i = F(r ? r[0] : void 0), a = (t) => {
			let n = L(t);
			kl(n, e.current) ? bl = e : Ol(n) || (bl = null);
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
function Rl(e) {
	let t = Wl.getTreeNode(bl);
	for (; t && t.scopeRef !== e;) {
		if (t.nodeToRestore) return !1;
		t = t.parent;
	}
	return t?.scopeRef === e;
}
function zl(e, t, n) {
	let r = (0, _.useRef)(typeof document < "u" ? na(F(e.current ? e.current[0] : void 0)) : null);
	P(() => {
		let r = e.current, i = F(r ? r[0] : void 0);
		if (!t || n) return;
		let a = () => {
			(!bl || Ml(bl, e)) && kl(na(i), e.current) && (bl = e);
		};
		return i.addEventListener("focusin", a, !1), r?.forEach((e) => e.addEventListener("focusin", a, !1)), () => {
			i.removeEventListener("focusin", a, !1), r?.forEach((e) => e.removeEventListener("focusin", a, !1));
		};
	}, [e, n]), P(() => {
		let r = F(e.current ? e.current[0] : void 0);
		if (!t) return;
		let i = (t) => {
			if (t.key !== "Tab" || t.altKey || t.ctrlKey || t.metaKey || !wl(e) || t.isComposing) return;
			let n = r.activeElement;
			if (!Al(n, e) || !Rl(e)) return;
			let i = Wl.getTreeNode(e);
			if (!i) return;
			let a = i.nodeToRestore, o = Vl(r.body, { tabbable: !0 });
			o.currentNode = n;
			let s = t.shiftKey ? o.previousNode() : o.nextNode();
			if ((!a || !a.isConnected || a === r.body) && (a = void 0, i.nodeToRestore = void 0), (!s || !Al(s, e)) && a) {
				o.currentNode = a;
				do
					s = t.shiftKey ? o.previousNode() : o.nextNode();
				while (Al(s, e));
				t.preventDefault(), t.stopPropagation(), s ? Nl(s, !0) : Ol(a) ? Nl(a, !0) : n.blur();
			}
		};
		return n || r.addEventListener("keydown", i, !0), () => {
			n || r.removeEventListener("keydown", i, !0);
		};
	}, [
		e,
		t,
		n
	]), P(() => {
		let n = F(e.current ? e.current[0] : void 0);
		if (!t) return;
		let i = Wl.getTreeNode(e);
		if (i) return i.nodeToRestore = r.current ?? void 0, () => {
			let r = Wl.getTreeNode(e);
			if (!r) return;
			let i = r.nodeToRestore, a = na(n);
			if (t && i && (a && Al(a, e) || a === n.body && Rl(e))) {
				let t = Wl.clone();
				requestAnimationFrame(() => {
					if (n.activeElement === n.body) {
						let n = t.getTreeNode(e);
						for (; n;) {
							if (n.nodeToRestore && n.nodeToRestore.isConnected) {
								Bl(n.nodeToRestore);
								return;
							}
							n = n.parent;
						}
						for (n = t.getTreeNode(e); n;) {
							if (n.scopeRef && n.scopeRef.current && Wl.getTreeNode(n.scopeRef)) {
								let e = Pl(n.scopeRef.current, !0);
								if (e) {
									Bl(e);
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
function Bl(e) {
	e.dispatchEvent(new CustomEvent(yl, {
		bubbles: !0,
		cancelable: !0
	})) && Nl(e);
}
function Vl(e, t, n) {
	let r = t?.tabbable ? fa : da, i = F(e?.nodeType === Node.ELEMENT_NODE ? e : null), a = Fc(i, e || i, NodeFilter.SHOW_ELEMENT, { acceptNode(e) {
		return I(t?.from, e) || t?.tabbable && e.tagName === "INPUT" && e.getAttribute("type") === "radio" && (!El(e) || a.currentNode.tagName === "INPUT" && a.currentNode.type === "radio" && a.currentNode.name === e.name) ? NodeFilter.FILTER_REJECT : r(e) && (!n || kl(e, n)) && (!t?.accept || t.accept(e)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
	} });
	return t?.from && (a.currentNode = t.from), a;
}
var Hl = class e {
	constructor() {
		this.fastMap = /* @__PURE__ */ new Map(), this.root = new Ul({ scopeRef: null }), this.fastMap.set(null, this.root);
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
		let i = new Ul({ scopeRef: e });
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
		for (let e of this.traverse()) e !== t && t.nodeToRestore && e.nodeToRestore && t.scopeRef && t.scopeRef.current && kl(e.nodeToRestore, t.scopeRef.current) && (e.nodeToRestore = t.nodeToRestore);
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
}, Ul = class {
	constructor(e) {
		this.children = /* @__PURE__ */ new Set(), this.contain = !1, this.scopeRef = e.scopeRef;
	}
	addChild(e) {
		this.children.add(e), e.parent = this;
	}
	removeChild(e) {
		this.children.delete(e), e.parent = void 0;
	}
}, Wl = new Hl();
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useInteractOutside.mjs
function Gl(e) {
	let { ref: t, onInteractOutside: n, isDisabled: r, onInteractOutsideStart: i } = e, a = (0, _.useRef)({
		isPointerDown: !1,
		ignoreEmulatedMouseEvents: !1
	}), o = z((e) => {
		n && Kl(e, t) && (i && i(e), a.current.isPointerDown = !0);
	}), s = z((e) => {
		n && n(e);
	});
	(0, _.useEffect)(() => {
		let e = a.current;
		if (r) return;
		let n = t.current, i = F(n);
		if (typeof PointerEvent < "u") {
			let n = (n) => {
				e.isPointerDown && Kl(n, t) && s(n), e.isPointerDown = !1;
			};
			return i.addEventListener("pointerdown", o, !0), i.addEventListener("click", n, !0), () => {
				i.removeEventListener("pointerdown", o, !0), i.removeEventListener("click", n, !0);
			};
		}
	}, [t, r]);
}
function Kl(e, t) {
	if (e.button > 0) return !1;
	let n = L(e);
	if (n) {
		let e = n.ownerDocument;
		if (!e || !I(e.documentElement, n) || n.closest("[data-react-aria-top-layer]")) return !1;
	}
	return t.current ? !e.composedPath().includes(t.current) : !1;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/useOverlay.mjs
var ql = [];
function Jl(e, t) {
	let { onClose: n, shouldCloseOnBlur: r, isOpen: i, isDismissable: a = !1, isKeyboardDismissDisabled: o = !1, shouldCloseOnInteractOutside: s } = e, c = (0, _.useRef)(void 0);
	(0, _.useEffect)(() => {
		if (i && !ql.includes(t)) return ql.push(t), () => {
			let e = ql.indexOf(t);
			e >= 0 && ql.splice(e, 1);
		};
	}, [i, t]);
	let l = () => {
		ql[ql.length - 1] === t && n && n();
	}, u = (e) => {
		let n = ql[ql.length - 1];
		c.current = n, (!s || s(L(e))) && n === t && e.stopPropagation();
	}, d = (e) => {
		(!s || s(L(e))) && (ql[ql.length - 1] === t && e.stopPropagation(), c.current === t && l()), c.current = void 0;
	}, { keyboardProps: f } = Ao({ shortcuts: { Escape: () => {
		if (!o) {
			l();
			return;
		}
		return !1;
	} } });
	Gl({
		ref: t,
		onInteractOutside: a && i ? d : void 0,
		onInteractOutsideStart: u
	});
	let { focusWithinProps: p } = ss({
		isDisabled: !r,
		onBlurWithin: (e) => {
			e.relatedTarget && !jl(e.relatedTarget) && (!s || s(e.relatedTarget)) && n?.();
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/isScrollable.mjs
function Yl(e, t) {
	if (!e) return !1;
	let n = window.getComputedStyle(e), r = document.scrollingElement || document.documentElement, i = /(auto|scroll)/.test(n.overflow + n.overflowX + n.overflowY);
	return e === r && n.overflow !== "hidden" && (i = !0), i && t && (i = e.scrollHeight !== e.clientHeight || e.scrollWidth !== e.clientWidth), i;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/getScrollParent.mjs
function Xl(e, t) {
	let n = e;
	for (Yl(n, t) && (n = n.parentElement); n && !Yl(n, t);) n = n.parentElement;
	return n || document.scrollingElement || document.documentElement;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/usePreventScroll.mjs
var Zl = typeof document < "u" && window.visualViewport, Ql = 0, $l;
function eu(e = {}) {
	let { isDisabled: t } = e;
	P(() => {
		if (!t) return Ql++, Ql === 1 && ($l = Ta() && Da() ? nu() : tu()), () => {
			Ql--, Ql === 0 && $l();
		};
	}, [t]);
}
function tu() {
	let e = window.innerWidth - document.documentElement.clientWidth;
	return jr(e > 0 && ("scrollbarGutter" in document.documentElement.style ? $i(document.documentElement, "scrollbar-gutter", "stable") : $i(document.documentElement, "padding-right", `${e}px`)), $i(document.documentElement, "overflow", "hidden"));
}
function nu() {
	let e = $i(document.documentElement, "overflow", "hidden"), t, n = !1, r = (e) => {
		let r = L(e);
		t = Yl(r) ? r : Xl(r, !0), n = !1;
		let i = r.ownerDocument.defaultView.getSelection();
		i && !i.isCollapsed && i.containsNode(r, !0) && (n = !0), e.composedPath().some((e) => e instanceof HTMLInputElement && e.type === "range") && (n = !0), "selectionStart" in r && "selectionEnd" in r && r.selectionStart < r.selectionEnd && r.ownerDocument.activeElement === r && (n = !0);
	}, i = document.createElement("style"), a = Ho();
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
		let t = L(e), n = e.relatedTarget;
		n && uc(n) ? (n.focus({ preventScroll: !0 }), ru(n, uc(t))) : n || (t.parentElement?.closest("[tabindex]"))?.focus({ preventScroll: !0 });
	}, c = HTMLElement.prototype.focus;
	Reflect.defineProperty(HTMLElement.prototype, "focus", {
		configurable: !0,
		writable: !0,
		value: function(e) {
			let t = na(), n = t != null && uc(t);
			c.call(this, {
				...e,
				preventScroll: !0
			}), (!e || !e.preventScroll) && ru(this, n);
		}
	});
	let l = jr(Qi(document, "touchstart", r, {
		passive: !1,
		capture: !0
	}), Qi(document, "touchmove", o, {
		passive: !1,
		capture: !0
	}), Qi(document, "blur", s, !0));
	return () => {
		e(), l(), i.remove(), Reflect.defineProperty(HTMLElement.prototype, "focus", {
			configurable: !0,
			writable: !0,
			value: c
		});
	};
}
function ru(e, t) {
	t || !Zl ? iu(e) : Zl.addEventListener("resize", () => iu(e), { once: !0 });
}
function iu(e) {
	let t = document.scrollingElement || document.documentElement, n = e;
	for (; n && n !== t;) {
		let e = Xl(n);
		if (e !== document.documentElement && e !== document.body && e !== n) {
			let t = e.getBoundingClientRect(), r = n.getBoundingClientRect();
			if (r.top < t.top || r.bottom > t.top + n.clientHeight) {
				let n = t.bottom;
				Zl && (n = Math.min(n, Zl.offsetTop + Zl.height));
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/usePopover.mjs
function au(e, t) {
	let { triggerRef: n, popoverRef: r, groupRef: i, isNonModal: a, isKeyboardDismissDisabled: o, shouldCloseOnInteractOutside: s, ...c } = e, l = c.trigger === "SubmenuTrigger", { overlayProps: u, underlayProps: d } = Jl({
		isOpen: t.isOpen,
		onClose: t.close,
		shouldCloseOnBlur: !0,
		isDismissable: !a || l,
		isKeyboardDismissDisabled: o,
		shouldCloseOnInteractOutside: s
	}, i ?? r), { overlayProps: f, arrowProps: p, placement: m, triggerAnchorPoint: h } = hl({
		...c,
		targetRef: n,
		overlayRef: r,
		isOpen: t.isOpen,
		onClose: a && !l ? t.close : null,
		getTargetRect: c.getTargetRect ?? (t.point ? () => new DOMRect(t.point.x, t.point.y, 0, 0) : void 0)
	});
	eu({ isDisabled: a || !t.isOpen }), (0, _.useEffect)(() => {
		if (t.isOpen && r.current) return a ? Vc(i?.current ?? r.current) : Bc([i?.current ?? r.current], { shouldUseInert: !0 });
	}, [
		a,
		t.isOpen,
		r,
		i
	]);
	let { focusWithinProps: g } = ss(e);
	return {
		popoverProps: ni(u, f, g),
		arrowProps: p,
		underlayProps: d,
		placement: m,
		triggerAnchorPoint: h
	};
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/ar-AE.mjs
var ou = {};
ou = { dismiss: "تجاهل" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/bg-BG.mjs
var su = {};
su = { dismiss: "Отхвърляне" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/cs-CZ.mjs
var cu = {};
cu = { dismiss: "Odstranit" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/da-DK.mjs
var lu = {};
lu = { dismiss: "Luk" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/de-DE.mjs
var uu = {};
uu = { dismiss: "Schließen" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/el-GR.mjs
var du = {};
du = { dismiss: "Απόρριψη" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/en-US.mjs
var fu = {};
fu = { dismiss: "Dismiss" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/es-ES.mjs
var pu = {};
pu = { dismiss: "Descartar" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/et-EE.mjs
var mu = {};
mu = { dismiss: "Lõpeta" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/fi-FI.mjs
var hu = {};
hu = { dismiss: "Hylkää" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/fr-FR.mjs
var gu = {};
gu = { dismiss: "Rejeter" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/he-IL.mjs
var _u = {};
_u = { dismiss: "התעלם" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/hr-HR.mjs
var vu = {};
vu = { dismiss: "Odbaci" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/hu-HU.mjs
var yu = {};
yu = { dismiss: "Elutasítás" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/it-IT.mjs
var bu = {};
bu = { dismiss: "Ignora" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/ja-JP.mjs
var xu = {};
xu = { dismiss: "閉じる" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/ko-KR.mjs
var Su = {};
Su = { dismiss: "무시" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/lt-LT.mjs
var Cu = {};
Cu = { dismiss: "Atmesti" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/lv-LV.mjs
var wu = {};
wu = { dismiss: "Nerādīt" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/nb-NO.mjs
var Tu = {};
Tu = { dismiss: "Lukk" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/nl-NL.mjs
var Eu = {};
Eu = { dismiss: "Negeren" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/pl-PL.mjs
var Du = {};
Du = { dismiss: "Zignoruj" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/pt-BR.mjs
var Ou = {};
Ou = { dismiss: "Descartar" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/pt-PT.mjs
var ku = {};
ku = { dismiss: "Dispensar" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/ro-RO.mjs
var Au = {};
Au = { dismiss: "Revocare" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/ru-RU.mjs
var ju = {};
ju = { dismiss: "Пропустить" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/sk-SK.mjs
var Mu = {};
Mu = { dismiss: "Zrušiť" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/sl-SI.mjs
var Nu = {};
Nu = { dismiss: "Opusti" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/sr-SP.mjs
var Pu = {};
Pu = { dismiss: "Odbaci" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/sv-SE.mjs
var Fu = {};
Fu = { dismiss: "Avvisa" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/tr-TR.mjs
var Iu = {};
Iu = { dismiss: "Kapat" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/uk-UA.mjs
var Lu = {};
Lu = { dismiss: "Скасувати" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/zh-CN.mjs
var Ru = {};
Ru = { dismiss: "取消" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/overlays/zh-TW.mjs
var zu = {};
zu = { dismiss: "關閉" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/intlStrings.mjs
var Bu = {};
Bu = {
	"ar-AE": ou,
	"bg-BG": su,
	"cs-CZ": cu,
	"da-DK": lu,
	"de-DE": uu,
	"el-GR": du,
	"en-US": fu,
	"es-ES": pu,
	"et-EE": mu,
	"fi-FI": hu,
	"fr-FR": gu,
	"he-IL": _u,
	"hr-HR": vu,
	"hu-HU": yu,
	"it-IT": bu,
	"ja-JP": xu,
	"ko-KR": Su,
	"lt-LT": Cu,
	"lv-LV": wu,
	"nb-NO": Tu,
	"nl-NL": Eu,
	"pl-PL": Du,
	"pt-BR": Ou,
	"pt-PT": ku,
	"ro-RO": Au,
	"ru-RU": ju,
	"sk-SK": Mu,
	"sl-SI": Nu,
	"sr-SP": Pu,
	"sv-SE": Fu,
	"tr-TR": Iu,
	"uk-UA": Lu,
	"zh-CN": Ru,
	"zh-TW": zu
};
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/visually-hidden/VisuallyHidden.mjs
var Vu = {
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
function Hu(e = {}) {
	let { style: t, isFocusable: n } = e, [r, i] = (0, _.useState)(!1), { focusWithinProps: a } = ss({
		isDisabled: !n,
		onFocusWithinChange: (e) => i(e)
	}), o = (0, _.useMemo)(() => r ? t : t ? {
		...Vu,
		...t
	} : Vu, [r]);
	return { visuallyHiddenProps: {
		...a,
		style: o
	} };
}
function Uu(e) {
	let { children: t, elementType: n = "div", isFocusable: r, style: i, ...a } = e, { visuallyHiddenProps: o } = Hu(e);
	return /*#__PURE__*/ _.createElement(n, ni(a, o), t);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/DismissButton.mjs
function Wu(e) {
	return e && e.__esModule ? e.default : e;
}
function Gu(e) {
	let { onDismiss: t, ...n } = e, r = wi(n, Tc(Wu(Bu), "@react-aria/overlays").format("dismiss")), i = () => {
		t && t();
	};
	return /*#__PURE__*/ _.createElement(Uu, null, /*#__PURE__*/ _.createElement("button", {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/PressResponder.mjs
var Ku = /*#__PURE__*/ _.forwardRef(({ children: e, ...t }, n) => {
	let r = (0, _.useRef)(!1), i = (0, _.useContext)(Uo), a = ni(i || {}, {
		...t,
		register() {
			r.current = !0, i && i.register();
		}
	});
	return a.ref = ri(n || i?.ref), jo(i, a.ref), (0, _.useEffect)(() => {
		r.current ||= !0;
	}, []), /*#__PURE__*/ _.createElement(Uo.Provider, { value: a }, e);
});
function qu({ children: e }) {
	let t = (0, _.useMemo)(() => ({ register: () => {} }), []);
	return /*#__PURE__*/ _.createElement(Uo.Provider, { value: t }, e);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/PortalProvider.mjs
var Ju = /*#__PURE__*/ (0, _.createContext)({});
function Yu() {
	return (0, _.useContext)(Ju) ?? {};
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/Overlay.mjs
var Xu = /*#__PURE__*/ _.createContext(null);
function Zu(e) {
	let t = Ur(), { portalContainer: n = t ? null : document.body, isExiting: r } = e, [i, a] = (0, _.useState)(!1), o = (0, _.useMemo)(() => ({
		contain: i,
		setContain: a
	}), [i, a]), { getContainer: s } = Yu();
	if (!e.portalContainer && s && (n = s()), !n) return null;
	let c = e.children;
	return e.disableFocusManagement || (c = /*#__PURE__*/ _.createElement(xl, {
		restoreFocus: !0,
		contain: (e.shouldContainFocus || i) && !r
	}, c)), c = /*#__PURE__*/ _.createElement(Xu.Provider, { value: o }, /*#__PURE__*/ _.createElement(qu, null, /*#__PURE__*/ _.createElement(Mo.Provider, { value: null }, c))), /*#__PURE__*/ Ko.createPortal(c, n);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/overlays/useOverlayTriggerState.mjs
function Qu(e) {
	let [t, n] = Dc(e.isOpen, e.defaultOpen || !1, e.onOpenChange), [r, i] = (0, _.useState)(null);
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/animation.mjs
function $u(e, t = !0) {
	let [n, r] = (0, _.useState)(!0), i = n && t;
	return P(() => {
		if (i && e.current && "getAnimations" in e.current) for (let t of e.current.getAnimations()) t instanceof CSSTransition && t.cancel();
	}, [e, i]), td(e, i, (0, _.useCallback)(() => r(!1), [])), i;
}
function ed(e, t) {
	let [n, r] = (0, _.useState)(t ? "open" : "closed");
	switch (n) {
		case "open":
			t || r("exiting");
			break;
		case "closed":
		case "exiting": t && r("open");
	}
	let i = n === "exiting";
	return td(e, i, (0, _.useCallback)(() => {
		r((e) => e === "exiting" ? "closed" : e);
	}, [])), i;
}
function td(e, t, n) {
	P(() => {
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
				r || (0, Ko.flushSync)(() => {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria-components/dist/private/Popover.mjs
var nd = /*#__PURE__*/ (0, _.createContext)(null), rd = /*#__PURE__*/ (0, _.createContext)(null), id = /*#__PURE__*/ (0, _.forwardRef)(function(e, t) {
	[e, t] = ci(e, t, nd);
	let n = (0, _.useContext)(V), r = Qu(e), i = e.isOpen != null || e.defaultOpen != null || !n ? r : n, a = ed(t, i.isOpen), o = e.isExiting || !e.shouldSkipAnimation && a || !1, s = gi(), { direction: c } = Fi();
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
	return i && !i.isOpen && !o ? null : /*#__PURE__*/ _.createElement(ad, {
		...e,
		triggerRef: e.triggerRef,
		state: i,
		popoverRef: t,
		isExiting: o,
		dir: c
	});
});
function ad({ state: e, isExiting: t, UNSTABLE_portalContainer: n, clearContexts: r, ...i }) {
	let a = (0, _.useRef)(null), o = (0, _.useRef)(null), s = (0, _.useContext)(rd), c = s && i.trigger === "SubmenuTrigger", { popoverProps: l, underlayProps: u, arrowProps: d, placement: f, triggerAnchorPoint: p } = au({
		...i,
		offset: i.offset ?? 8,
		arrowRef: a,
		groupRef: c ? s : o
	}, e), m = i.popoverRef, h = $u(m, !!f), g = i.isEntering || !i.shouldSkipAnimation && h || !1, v = oi({
		...i,
		defaultClassName: "react-aria-Popover",
		values: {
			trigger: i.trigger || null,
			placement: f,
			isEntering: g,
			isExiting: t
		}
	}), y = !i.isNonModal || i.trigger === "SubmenuTrigger" || i.trigger === "PreviewTrigger", [b, x] = (0, _.useState)(i.trigger === "PreviewTrigger");
	P(() => {
		m.current && x(y && !m.current.querySelector("[role=dialog]"));
	}, [m, y]), (0, _.useEffect)(() => {
		b && i.trigger !== "PreviewTrigger" && (i.trigger !== "SubmenuTrigger" || io() !== "pointer") && m.current && !ia(m.current) && ho(m.current);
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
	P(T, [T]), pl({
		ref: v.style?.["--trigger-width"] ? void 0 : i.triggerRef,
		onResize: T
	});
	let ee = {
		...l.style,
		"--trigger-anchor-point": p ? `${p.x}px ${p.y}px` : void 0,
		...v.style,
		"--trigger-width": v.style?.["--trigger-width"] || C
	}, E = /*#__PURE__*/ _.createElement(fi.div, {
		...ni(Ci(i, { global: !0 }), l),
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
	}, !i.isNonModal && /*#__PURE__*/ _.createElement(Gu, { onDismiss: e.close }), /*#__PURE__*/ _.createElement(Nc.Provider, { value: {
		...d,
		placement: f,
		ref: a
	} }, S), /*#__PURE__*/ _.createElement(Gu, { onDismiss: e.close }));
	return c ? /*#__PURE__*/ _.createElement(Zu, {
		...i,
		shouldContainFocus: b && i.trigger !== "PreviewTrigger",
		isExiting: t,
		portalContainer: n ?? s?.current ?? void 0
	}, E) : /*#__PURE__*/ _.createElement(Zu, {
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
	}, /*#__PURE__*/ _.createElement(rd.Provider, { value: o }, E)));
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria-components/dist/private/Text.mjs
var od = /*#__PURE__*/ (0, _.createContext)({});
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/menu/useMenuTriggerState.mjs
function sd(e) {
	let t = Qu(e), [n, r] = (0, _.useState)(null), [i, a] = (0, _.useState)([]), o = () => {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/overlays/useOverlayTrigger.mjs
function B(e, t, n) {
	let { type: r } = e, { isOpen: i } = t;
	(0, _.useEffect)(() => {
		n && n.current && ul.set(n.current, t.close);
	});
	let a;
	r === "menu" ? a = !0 : r === "listbox" && (a = "listbox");
	let o = Yr();
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria-components/dist/private/Dialog.mjs
var V = /*#__PURE__*/ (0, _.createContext)(null), cd = /*#__PURE__*/ (0, _.createContext)(null);
function ld(e) {
	let t = (0, _.useRef)({});
	return /*#__PURE__*/ _.createElement(cd.Provider, { value: t }, e.children);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria-components/dist/private/SelectionIndicator.mjs
var ud = /*#__PURE__*/ (0, _.createContext)({ isSelected: !1 }), dd = /*#__PURE__*/ (0, _.createContext)({});
(class extends ys {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/ar-AE.mjs
var fd = {};
fd = { longPressMessage: "اضغط مطولاً أو اضغط على Alt + السهم لأسفل لفتح القائمة" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/bg-BG.mjs
var pd = {};
pd = { longPressMessage: "Натиснете продължително или натиснете Alt+ стрелка надолу, за да отворите менюто" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/cs-CZ.mjs
var md = {};
md = { longPressMessage: "Dlouhým stiskem nebo stisknutím kláves Alt + šipka dolů otevřete nabídku" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/da-DK.mjs
var hd = {};
hd = { longPressMessage: "Langt tryk eller tryk på Alt + pil ned for at åbne menuen" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/de-DE.mjs
var gd = {};
gd = { longPressMessage: "Drücken Sie lange oder drücken Sie Alt + Nach-unten, um das Menü zu öffnen" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/el-GR.mjs
var _d = {};
_d = { longPressMessage: "Πιέστε παρατεταμένα ή πατήστε Alt + κάτω βέλος για να ανοίξετε το μενού" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/en-US.mjs
var vd = {};
vd = { longPressMessage: "Long press or press Alt + ArrowDown to open menu" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/es-ES.mjs
var yd = {};
yd = { longPressMessage: "Mantenga pulsado o pulse Alt + flecha abajo para abrir el menú" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/et-EE.mjs
var bd = {};
bd = { longPressMessage: "Menüü avamiseks vajutage pikalt või vajutage klahve Alt + allanool" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/fi-FI.mjs
var xd = {};
xd = { longPressMessage: "Avaa valikko painamalla pohjassa tai näppäinyhdistelmällä Alt + Alanuoli" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/fr-FR.mjs
var Sd = {};
Sd = { longPressMessage: "Appuyez de manière prolongée ou appuyez sur Alt\xA0+\xA0Flèche vers le bas pour ouvrir le menu." };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/he-IL.mjs
var Cd = {};
Cd = { longPressMessage: "לחץ לחיצה ארוכה או הקש Alt + ArrowDown כדי לפתוח את התפריט" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/hr-HR.mjs
var wd = {};
wd = { longPressMessage: "Dugo pritisnite ili pritisnite Alt + strelicu prema dolje za otvaranje izbornika" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/hu-HU.mjs
var Td = {};
Td = { longPressMessage: "Nyomja meg hosszan, vagy nyomja meg az Alt + lefele nyíl gombot a menü megnyitásához" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/it-IT.mjs
var Ed = {};
Ed = { longPressMessage: "Premi a lungo o premi Alt + Freccia giù per aprire il menu" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/ja-JP.mjs
var Dd = {};
Dd = { longPressMessage: "長押しまたは Alt+下矢印キーでメニューを開く" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/ko-KR.mjs
var Od = {};
Od = { longPressMessage: "길게 누르거나 Alt + 아래쪽 화살표를 눌러 메뉴 열기" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/lt-LT.mjs
var kd = {};
kd = { longPressMessage: "Norėdami atidaryti meniu, nuspaudę palaikykite arba paspauskite „Alt + ArrowDown“." };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/lv-LV.mjs
var Ad = {};
Ad = { longPressMessage: "Lai atvērtu izvēlni, turiet nospiestu vai nospiediet taustiņu kombināciju Alt + lejupvērstā bultiņa" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/nb-NO.mjs
var jd = {};
jd = { longPressMessage: "Langt trykk eller trykk Alt + PilNed for å åpne menyen" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/nl-NL.mjs
var Md = {};
Md = { longPressMessage: "Druk lang op Alt + pijl-omlaag of druk op Alt om het menu te openen" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/pl-PL.mjs
var Nd = {};
Nd = { longPressMessage: "Naciśnij i przytrzymaj lub naciśnij klawisze Alt + Strzałka w dół, aby otworzyć menu" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/pt-BR.mjs
var Pd = {};
Pd = { longPressMessage: "Pressione e segure ou pressione Alt + Seta para baixo para abrir o menu" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/pt-PT.mjs
var Fd = {};
Fd = { longPressMessage: "Prima continuamente ou prima Alt + Seta Para Baixo para abrir o menu" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/ro-RO.mjs
var Id = {};
Id = { longPressMessage: "Apăsați lung sau apăsați pe Alt + săgeată în jos pentru a deschide meniul" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/ru-RU.mjs
var Ld = {};
Ld = { longPressMessage: "Нажмите и удерживайте или нажмите Alt + Стрелка вниз, чтобы открыть меню" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/sk-SK.mjs
var Rd = {};
Rd = { longPressMessage: "Ponuku otvoríte dlhým stlačením alebo stlačením klávesu Alt + klávesu so šípkou nadol" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/sl-SI.mjs
var zd = {};
zd = { longPressMessage: "Za odprtje menija pritisnite in držite gumb ali pritisnite Alt+puščica navzdol" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/sr-SP.mjs
var Bd = {};
Bd = { longPressMessage: "Dugo pritisnite ili pritisnite Alt + strelicu prema dole da otvorite meni" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/sv-SE.mjs
var Vd = {};
Vd = { longPressMessage: "Håll nedtryckt eller tryck på Alt + pil nedåt för att öppna menyn" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/tr-TR.mjs
var Hd = {};
Hd = { longPressMessage: "Menüyü açmak için uzun basın veya Alt + Aşağı Ok tuşuna basın" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/uk-UA.mjs
var Ud = {};
Ud = { longPressMessage: "Довго або звичайно натисніть комбінацію клавіш Alt і стрілка вниз, щоб відкрити меню" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/zh-CN.mjs
var Wd = {};
Wd = { longPressMessage: "长按或按 Alt + 向下方向键以打开菜单" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/intl/menu/zh-TW.mjs
var Gd = {};
Gd = { longPressMessage: "長按或按 Alt+向下鍵以開啟功能表" };
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/menu/intlStrings.mjs
var Kd = {};
Kd = {
	"ar-AE": fd,
	"bg-BG": pd,
	"cs-CZ": md,
	"da-DK": hd,
	"de-DE": gd,
	"el-GR": _d,
	"en-US": vd,
	"es-ES": yd,
	"et-EE": bd,
	"fi-FI": xd,
	"fr-FR": Sd,
	"he-IL": Cd,
	"hr-HR": wd,
	"hu-HU": Td,
	"it-IT": Ed,
	"ja-JP": Dd,
	"ko-KR": Od,
	"lt-LT": kd,
	"lv-LV": Ad,
	"nb-NO": jd,
	"nl-NL": Md,
	"pl-PL": Nd,
	"pt-BR": Pd,
	"pt-PT": Fd,
	"ro-RO": Id,
	"ru-RU": Ld,
	"sk-SK": Rd,
	"sl-SI": zd,
	"sr-SP": Bd,
	"sv-SE": Vd,
	"tr-TR": Hd,
	"uk-UA": Ud,
	"zh-CN": Wd,
	"zh-TW": Gd
};
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useDescription.mjs
var qd = 0, Jd = /* @__PURE__ */ new Map();
function Yd(e) {
	let [t, n] = (0, _.useState)();
	return P(() => {
		if (!e) return;
		let t = Jd.get(e);
		if (t) n(t.element.id);
		else {
			let r = `react-aria-description-${qd++}`;
			n(r);
			let i = document.createElement("div");
			i.id = r, i.style.display = "none", i.textContent = e, document.body.appendChild(i), t = {
				refCount: 0,
				element: i
			}, Jd.set(e, t);
		}
		return t.refCount++, () => {
			t && --t.refCount === 0 && (t.element.remove(), Jd.delete(e));
		};
	}, [e]), { "aria-describedby": e ? t : void 0 };
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useLongPress.mjs
var Xd = 500;
function Zd(e) {
	let { isDisabled: t, pointerType: n, onLongPressStart: r, onLongPressEnd: i, onLongPress: a, threshold: o = Xd, accessibilityDescription: s } = e, c = (0, _.useRef)(void 0), { addGlobalListener: l, removeAllGlobalListeners: u } = Go(), d = (e) => n ? e.pointerType === n : e.pointerType === "mouse" || e.pointerType === "touch", { pressProps: f } = Qo({
		isDisabled: t,
		onPressStart(e) {
			if (e.continuePropagation(), d(e)) {
				r && r({
					...e,
					type: "longpressstart"
				}), c.current = setTimeout(() => {
					e.target.dispatchEvent(new PointerEvent("pointercancel", { bubbles: !0 })), l(e.target, "click", (e) => e.preventDefault(), { once: !0 }), F(e.target).activeElement !== e.target && Hi(e.target), a && a({
						...e,
						type: "longpress"
					}), c.current = void 0;
				}, o), e.pointerType === "touch" && l(e.target, "contextmenu", (e) => e.preventDefault(), { once: !0 });
				let t = qi(e.target);
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
	return { longPressProps: ni(f, Yd(a && !t ? s : void 0)) };
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/interactions/useContextMenu.mjs
function Qd(e) {
	let { onContextMenu: t } = e, n = (0, _.useRef)(!1), { longPressProps: r } = Zd({
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
	return t ? { contextMenuProps: ni(Ta() ? r : {}, {
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
			if (Sa() && e.ctrlKey && e.key === "Enter") {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/menu/useMenuTrigger.mjs
function $d(e) {
	return e && e.__esModule ? e.default : e;
}
function ef(e, t, n) {
	let { type: r = "menu", isDisabled: i, trigger: a = "press" } = e, o = Yr(), { triggerProps: s, overlayProps: c } = B({ type: r }, t, n), l = (e, n, r = "first") => {
		if (!e || n.isDefaultPrevented()) return !1;
		t.toggle(r);
	}, { keyboardProps: u } = Ao({
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
	}), d = Tc($d(Kd), "@react-aria/menu"), { longPressProps: f } = Zd({
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
			e.pointerType !== "touch" && e.pointerType !== "keyboard" && !i && (Hi(e.target), t.open(e.pointerType === "virtual" ? "first" : null));
		},
		onPress(e) {
			e.pointerType === "touch" && !i && (Hi(e.target), t.toggle());
		}
	};
	delete s.onPress;
	let { contextMenuProps: m } = Qd({ onContextMenu(e) {
		let n = e.target.getBoundingClientRect();
		t.setPoint({
			x: n.x + e.x,
			y: n.y + e.y
		}), t.open();
	} });
	(0, _.useEffect)(() => {
		if (t.isOpen && a === "contextMenu") {
			let e = (e) => {
				(e.button === 2 || e.button === 0 && e.ctrlKey === !0) && L(e) === document.body && t.close();
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/menu/utils.mjs
var tf = /* @__PURE__ */ new WeakMap();
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/selection/utils.mjs
function nf(e) {
	return Ea() ? e.altKey : e.ctrlKey;
}
function rf(e, t) {
	let n = `[data-key="${CSS.escape(String(t))}"]`, r = e.current?.dataset.collection;
	return r && (n = `[data-collection="${CSS.escape(r)}"]${n}`), e.current?.querySelector(n);
}
var af = /* @__PURE__ */ new WeakMap();
function of(e) {
	let t = Yr();
	return af.set(e, t), t;
}
function sf(e) {
	return af.get(e);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/getScrollParents.mjs
function cf(e, t) {
	let n = [], r = document.scrollingElement || document.documentElement;
	for (; e && (Yl(e, t) && n.push(e), e !== r);) e = e.parentElement;
	return n;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/scrollIntoView.mjs
function lf(e, t, n = {}) {
	e !== t && uf(e, t, t.getBoundingClientRect(), n);
}
function uf(e, t, n, r = {}) {
	let { block: i = "nearest", inline: a = "nearest" } = r, o = e.scrollTop, s = e.scrollLeft, c = e.getBoundingClientRect(), l = window.getComputedStyle(t), u = window.getComputedStyle(e), d = document.scrollingElement || document.documentElement, f = e === d, p = e === d ? 0 : c.top, m = e === d ? e.clientHeight : c.bottom, h = e === d ? 0 : c.left, g = e === d ? e.clientWidth : c.right, _ = parseFloat(l.scrollMarginTop) || 0, v = parseFloat(l.scrollMarginBottom) || 0, y = parseFloat(l.scrollMarginLeft) || 0, b = parseFloat(l.scrollMarginRight) || 0, x = parseFloat(u.scrollPaddingTop) || 0, S = parseFloat(u.scrollPaddingBottom) || 0, C = parseFloat(u.scrollPaddingLeft) || 0, w = parseFloat(u.scrollPaddingRight) || 0, T = parseFloat(u.borderTopWidth) || 0, ee = parseFloat(u.borderBottomWidth) || 0, E = parseFloat(u.borderLeftWidth) || 0, te = parseFloat(u.borderRightWidth) || 0, ne = n.top - _, D = n.bottom + v, re = n.left - y, ie = n.right + b, ae = e === d ? 0 : E + te, oe = e === d ? 0 : T + ee, se = e === d ? 0 : e.offsetWidth - e.clientWidth - ae, ce = e === d ? 0 : e.offsetHeight - e.clientHeight - oe, le = p + (f ? 0 : T) + x, ue = m - (f ? 0 : ee) - S - ce, de = h + (f ? 0 : E) + C, fe = g - (f ? 0 : te) - w;
	Ta() && Da() || u.direction === "ltr" ? fe -= se : u.direction === "rtl" && (de += se);
	let pe = ne < le || D > ue, me = re < de || ie > fe;
	if (pe && i === "start") o += ne - le;
	else if (pe && i === "center") o += (ne + D) / 2 - (le + ue) / 2;
	else if (pe && i === "end") o += D - ue;
	else if (pe && i === "nearest") {
		let e = ne - le, t = D - ue;
		o += Math.abs(e) <= Math.abs(t) ? e : t;
	}
	if (me && a === "start") s += re - de;
	else if (me && a === "center") s += (re + ie) / 2 - (de + fe) / 2;
	else if (me && a === "end") s += ie - fe;
	else if (me && a === "nearest") {
		let e = re - de, t = ie - fe;
		s += Math.abs(e) <= Math.abs(t) ? e : t;
	}
	e.scrollTo({
		left: s,
		top: o
	});
}
function df(e, t = {}) {
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
			let { left: t, top: r } = e.getBoundingClientRect(), i = cf(e, !0);
			for (let t of i) lf(t, e);
			let { left: a, top: o } = e.getBoundingClientRect();
			if (Math.abs(t - a) > 1 || Math.abs(r - o) > 1) {
				i = n ? cf(n, !0) : [];
				for (let e of i) lf(e, n, {
					block: "center",
					inline: "center"
				});
				for (let t of cf(e, !0)) lf(t, e);
			}
		}
	}
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/selection/useTypeSelect.mjs
var ff = 1e3;
function pf(e) {
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
				}, ff);
			}
		} : void 0,
		onKeyDown: t.getKeyForSearch ? (e) => {
			let a = mf(e.key);
			if (!(!a || e.ctrlKey || e.metaKey || e.altKey || !I(e.currentTarget, L(e)) || i.current.search.length === 0 && a === " ")) {
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
				}, ff);
			}
		} : void 0
	} };
}
function mf(e) {
	return e.length === 1 || !/^[A-Z]/i.test(e) ? e : "";
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useUpdateLayoutEffect.mjs
function hf(e, t) {
	let n = (0, _.useRef)(!0), r = (0, _.useRef)(null);
	P(() => (n.current = !0, () => {
		n.current = !1;
	}), []), P(() => {
		n.current ? n.current = !1 : (!r.current || t.some((e, t) => !Object.is(e, r[t]))) && e(), r.current = t;
	}, t);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/selection/useSelectableCollection.mjs
function gf(e) {
	let { selectionManager: t, keyboardDelegate: n, ref: r, autoFocus: i = !1, shouldFocusWrap: a = !1, disallowEmptySelection: o = !1, disallowSelectAll: s = !1, escapeKeyBehavior: c = "clearSelection", selectOnFocus: l = t.selectionBehavior === "replace", disallowTypeAhead: u = !1, shouldUseVirtualFocus: d, allowsTabNavigation: f = !1, scrollRef: p = r, linkBehavior: m = "action", UNSTABLE_focusOnEntry: h } = e, { direction: g } = Fi(), v = Pa(), y = (e, n, i) => {
		if (n != null) {
			if (t.isLink(n) && m === "selection" && l && !nf(e)) {
				(0, Ko.flushSync)(() => {
					t.setFocusedKey(n, i);
				});
				let a = rf(r, n), o = t.getItemProps(n);
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
			if (l && !nf(e)) {
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
			let r = n.getFirstKey(t.focusedKey, cc(e));
			if (t.setFocusedKey(r), r != null) {
				if (cc(e) && e.shiftKey && t.selectionMode === "multiple") {
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
			let r = n.getLastKey(t.focusedKey, cc(e));
			if (t.setFocusedKey(r), r != null) {
				if (cc(e) && e.shiftKey && t.selectionMode === "multiple") {
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
	}, ne = () => {
		if (c === "clearSelection" && !o && t.selectedKeys.size !== 0) {
			t.clearSelection();
			return;
		}
		return !1;
	}, D = () => {
		if (!f && r.current) {
			let e = Vl(r.current, { tabbable: !0 }), t, n;
			do
				n = e.lastChild(), n && (t = n);
			while (n);
			let i = na();
			t && (!ia(t) || i && !fa(i)) && Hi(t);
		}
		return {
			shouldContinuePropagation: !0,
			shouldPreventDefault: !1
		};
	}, re = () => (!f && r.current && r.current.focus(), {
		shouldContinuePropagation: !0,
		shouldPreventDefault: !1
	}), ie = (e, t) => ({
		[Sa() ? e + "+Shift+Alt" : e + "+Shift+Control"]: t,
		[e + "+Shift"]: t,
		[Sa() ? e + "+Alt" : e + "+Control"]: t,
		[e]: t
	}), { keyboardProps: ae } = Ao({
		shortcuts: {
			...ie("ArrowDown", b),
			...ie("ArrowUp", x),
			...ie("ArrowLeft", C),
			...ie("ArrowRight", w),
			...ie("PageDown", ee),
			...ie("PageUp", E)
		},
		allowRepeats: !0
	}), { keyboardProps: oe } = Ao({ shortcuts: {
		...ie("Home", S),
		...ie("End", T),
		"Mod+A": te,
		Escape: ne,
		Tab: D,
		"Tab+Shift": re
	} }), se = (0, _.useRef)({
		top: 0,
		left: 0
	});
	dc(p, "scroll", () => {
		se.current = {
			top: p.current?.scrollTop ?? 0,
			left: p.current?.scrollLeft ?? 0
		};
	});
	let ce = (e) => {
		if (t.isFocused) {
			I(e.currentTarget, L(e)) || t.setFocused(!1);
			return;
		}
		if (!I(e.currentTarget, L(e))) return;
		let i = io();
		t.setFocused(!0);
		let a = (e) => {
			e != null && (t.setFocusedKey(e), l && !t.isSelected(e) && t.replaceSelection(e));
		};
		if (h && (i === "keyboard" || i === "virtual")) a(h === "first" ? n.getFirstKey?.() : n.getLastKey?.());
		else if (t.focusedKey == null) {
			let r = e.relatedTarget;
			r && e.currentTarget.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING ? a(t.lastSelectedKey ?? n.getLastKey?.()) : a(t.firstSelectedKey ?? n.getFirstKey?.());
		} else p.current && (p.current.scrollTop = se.current.top, p.current.scrollLeft = se.current.left);
		if (t.focusedKey != null && p.current) {
			let e = rf(r, t.focusedKey);
			e instanceof HTMLElement && (!ia(e) && !d && Hi(e), (i === "keyboard" || h && i === "virtual") && df(e, { containingElement: r.current }));
		}
	}, le = (e) => {
		I(e.currentTarget, e.relatedTarget) || t.setFocused(!1);
	}, ue = (0, _.useRef)(!1);
	dc(r, rc, d ? (e) => {
		let { detail: n } = e;
		e.stopPropagation(), t.setFocused(!0), n?.focusStrategy === "first" && (ue.current = !0);
	} : void 0);
	let de = n.getFirstKey?.() ?? null;
	hf(() => {
		if (ue.current) {
			if (de == null) {
				let e = na();
				ic(r.current), oc(e, null), t.collection.size > 0 && (ue.current = !1);
			} else t.setFocusedKey(de), ue.current = !1;
		}
	}, [de, t.collection.size]), hf(() => {
		t.collection.size > 0 && (ue.current = !1);
	}, [t.focusedKey]), dc(r, nc, d ? (e) => {
		e.stopPropagation(), t.setFocused(!1), e.detail?.clearFocusKey && t.setFocusedKey(null);
	} : void 0);
	let fe = (0, _.useRef)(i), pe = (0, _.useRef)(!1);
	(0, _.useEffect)(() => {
		if (fe.current) {
			let e = null;
			i === "first" && (e = n.getFirstKey?.() ?? null), i === "last" && (e = n.getLastKey?.() ?? null);
			let a = t.selectedKeys;
			if (a.size) {
				for (let n of a) if (t.canSelectItem(n)) {
					e = n;
					break;
				}
			}
			t.setFocused(!0), t.setFocusedKey(e), e != null && l && !a.size && t.canSelectItem(e) && t.replaceSelection(e), e == null && !d && r.current && ho(r.current), t.collection.size > 0 && (fe.current = !1, pe.current = !0);
		}
	});
	let me = (0, _.useRef)(t.focusedKey), he = (0, _.useRef)(null);
	(0, _.useEffect)(() => {
		if (t.isFocused && t.focusedKey != null && (t.focusedKey !== me.current || pe.current) && p.current && r.current) {
			let e = io(), n = rf(r, t.focusedKey);
			if (!(n instanceof HTMLElement)) return;
			(e === "keyboard" || pe.current) && (he.current && cancelAnimationFrame(he.current), he.current = requestAnimationFrame(() => {
				p.current && (lf(p.current, n), e !== "virtual" && df(n, { containingElement: r.current }));
			}));
		}
		!d && t.isFocused && t.focusedKey == null && me.current != null && r.current && ho(r.current), me.current = t.focusedKey, pe.current = !1;
	}), (0, _.useEffect)(() => () => {
		he.current && cancelAnimationFrame(he.current);
	}, []), dc(r, "react-aria-focus-scope-restore", (e) => {
		e.preventDefault(), t.setFocused(!0);
	});
	let ge = {
		...ni(oe, ae),
		onFocus: ce,
		onBlur: le,
		onMouseDown(e) {
			p.current === L(e) && e.preventDefault();
		}
	}, { typeSelectProps: _e } = pf({
		keyboardDelegate: n,
		selectionManager: t
	});
	u || (ge = ni(_e, ge));
	let ve;
	d || (ve = t.focusedKey == null ? 0 : -1);
	let ye = of(t.collection);
	return { collectionProps: ni(ge, {
		tabIndex: ve,
		"data-collection": ye
	}) };
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/selection/DOMLayoutDelegate.mjs
var _f = class {
	constructor(e) {
		this.ref = e;
	}
	getItemRect(e) {
		let t = this.ref.current;
		if (!t) return null;
		let n = e == null ? null : rf(this.ref, e);
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
}, vf = class {
	constructor(...e) {
		if (e.length === 1) {
			let t = e[0];
			this.collection = t.collection, this.ref = t.ref, this.collator = t.collator, this.disabledKeys = t.disabledKeys || /* @__PURE__ */ new Set(), this.disabledBehavior = t.disabledBehavior || "all", this.orientation = t.orientation || "vertical", this.direction = t.direction, this.layout = t.layout || "stack", this.layoutDelegate = t.layoutDelegate || new _f(t.ref);
		} else this.collection = e[0], this.disabledKeys = e[1], this.ref = e[2], this.collator = e[3], this.layout = "stack", this.orientation = "vertical", this.disabledBehavior = "all", this.layoutDelegate = new _f(this.ref);
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
		let t = this.getNextKey(e), n = rf(this.ref, e);
		if (t != null) {
			let e = rf(this.ref, t);
			return !n || !e ? !1 : n.getBoundingClientRect().top > e.getBoundingClientRect().top;
		}
		let r = this.getPreviousKey(e);
		if (r != null) {
			let e = rf(this.ref, r);
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
		if (t && !Yl(t)) return this.getFirstKey();
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
		if (t && !Yl(t)) return this.getLastKey();
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
}, yf = /* @__PURE__ */ new Map();
function bf(e) {
	let { locale: t } = Fi(), n = t + (e ? Object.entries(e).sort((e, t) => e[0] < t[0] ? -1 : 1).join() : "");
	if (yf.has(n)) return yf.get(n);
	let r = new Intl.Collator(t, e);
	return yf.set(n, r), r;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/selection/useSelectableList.mjs
function xf(e) {
	let { selectionManager: t, collection: n, disabledKeys: r, ref: i, keyboardDelegate: a, layoutDelegate: o, orientation: s } = e, c = bf({
		usage: "search",
		sensitivity: "base"
	}), l = t.disabledBehavior, u = (0, _.useMemo)(() => a || new vf({
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
	]), { collectionProps: d } = gf({
		...e,
		ref: i,
		selectionManager: t,
		keyboardDelegate: u
	});
	return { listProps: d };
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/menu/useMenu.mjs
function Sf(e, t, n) {
	let { shouldFocusWrap: r = !0, onKeyDown: i, onKeyUp: a, ...o } = e;
	!e["aria-label"] && e["aria-labelledby"];
	let s = Ci(e, { labelable: !0 }), { listProps: c } = xf({
		...o,
		ref: n,
		selectionManager: t.selectionManager,
		collection: t.collection,
		disabledKeys: t.disabledKeys,
		shouldFocusWrap: r,
		linkBehavior: "override"
	});
	return tf.set(t, {
		onClose: e.onClose,
		onAction: e.onAction,
		shouldUseVirtualFocus: e.shouldUseVirtualFocus
	}), { menuProps: ni(s, {
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/selection/useSelectableItem.mjs
function Cf(e) {
	let { id: t, selectionManager: n, key: r, ref: i, shouldSelectOnPressUp: a, shouldUseVirtualFocus: o, focus: s, isDisabled: c, onAction: l, allowsDifferentPressOrigin: u, linkBehavior: d = "action" } = e, f = Pa();
	t = Yr(t);
	let p = (e) => {
		if (e.pointerType === "keyboard" && nf(e)) n.toggleSelection(r);
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
			n.selectionMode === "single" ? n.isSelected(r) && !n.disallowEmptySelection ? n.toggleSelection(r) : n.replaceSelection(r) : e && e.shiftKey ? n.extendSelection(r) : n.selectionBehavior === "toggle" || e && (cc(e) || e.pointerType === "touch" || e.pointerType === "virtual") ? n.toggleSelection(r) : n.replaceSelection(r);
		}
	};
	(0, _.useEffect)(() => {
		r === n.focusedKey && n.isFocused && (o ? ic(i.current) : s ? s() : na() !== i.current && i.current && ho(i.current));
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
			L(e) === i.current && n.setFocusedKey(r);
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
	let h = n.isLink(r) && d === "override", g = l && e.UNSTABLE_itemBehavior === "action", v = n.isLink(r) && d !== "selection" && d !== "none", y = !c && n.canSelectItem(r) && !h && !g, b = (l || v) && !c, x = b && (n.selectionBehavior === "replace" ? !y : !y || n.isEmpty), S = b && y && n.selectionBehavior === "replace", C = x || S, w = (0, _.useRef)(null), T = C && y, ee = (0, _.useRef)(!1), E = (0, _.useRef)(!1), te = n.getItemProps(r), ne = (e) => {
		l && (l(), i.current?.dispatchEvent(new CustomEvent("react-aria-item-action", { bubbles: !0 }))), v && i.current && f.open(i.current, e, te.href, te.routerOptions);
	}, D = { ref: i };
	a ? (D.onPressStart = (e) => {
		w.current = e.pointerType, ee.current = T, e.pointerType === "keyboard" && (!C || Tf(e.key)) && p(e);
	}, u ? (D.onPressUp = x ? void 0 : (e) => {
		e.pointerType === "mouse" && y && p(e);
	}, D.onPress = x ? ne : (e) => {
		e.pointerType !== "keyboard" && e.pointerType !== "mouse" && y && p(e);
	}) : D.onPress = (e) => {
		if (x || S && e.pointerType !== "mouse") {
			if (e.pointerType === "keyboard" && !wf(e.key)) return;
			ne(e);
		} else e.pointerType !== "keyboard" && y && p(e);
	}) : (D.onPressStart = (e) => {
		w.current = e.pointerType, ee.current = T, E.current = x, y && (e.pointerType === "mouse" && !x || e.pointerType === "keyboard" && (!b || Tf(e.key))) && p(e);
	}, D.onPress = (e) => {
		(e.pointerType === "touch" || e.pointerType === "pen" || e.pointerType === "virtual" || e.pointerType === "keyboard" && C && wf(e.key) || e.pointerType === "mouse" && E.current) && (C ? ne(e) : y && p(e));
	});
	let re = sf(n.collection);
	if (m["data-collection"] = re, m["data-key"] = r, D.preventFocusOnPress = o, o && (D = ni(D, {
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
	]) te[e] && (D[e] = jr(D[e], te[e]));
	let { pressProps: ie, isPressed: ae } = Qo(D), oe = S ? (e) => {
		w.current === "mouse" && (e.stopPropagation(), e.preventDefault(), ne(e));
	} : void 0, { longPressProps: se } = Zd({
		isDisabled: !T,
		onLongPress(e) {
			e.pointerType === "touch" && (p(e), n.setSelectionBehavior("toggle"));
		}
	}), ce = (e) => {
		w.current === "touch" && ee.current && e.preventDefault();
	}, le = d !== "none" && n.isLink(r) ? (e) => {
		Ia.isOpening || e.preventDefault();
	} : void 0, ue = ni(m, y || x || o && !c ? ie : {}, T ? se : {}, {
		onDoubleClick: oe,
		onDragStartCapture: ce,
		onClick: le,
		id: t
	}, o ? { onMouseDown: (e) => e.preventDefault() } : void 0), de = (e) => {
		let t = e;
		for (; t && t !== i.current;) {
			let e = t.getAttribute("data-collection");
			if (e != null) return e !== re;
			t = t.parentElement;
		}
		return fa(e);
	}, fe = ue.onPointerDown;
	ue.onPointerDown = (e) => {
		let t = L(e);
		if (t && t !== i.current && de(t)) {
			e.stopPropagation();
			return;
		}
		fe?.(e);
	};
	let pe = ue.onMouseDown;
	return ue.onMouseDown = (e) => {
		let t = L(e);
		if (t && t !== i.current && de(t)) {
			e.stopPropagation();
			return;
		}
		pe?.(e);
	}, {
		itemProps: ue,
		isPressed: ae,
		isSelected: n.isSelected(r),
		isFocused: n.isFocused && n.focusedKey === r,
		isDisabled: c,
		allowsSelection: y,
		hasAction: C
	};
}
function wf(e) {
	return e === "Enter";
}
function Tf(e) {
	return e === " ";
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/collections/getChildNodes.mjs
function Ef(e, t) {
	return typeof t.getChildren == "function" ? t.getChildren(e.key) : e.childNodes;
}
function Df(e) {
	return Of(e, 0);
}
function Of(e, t) {
	if (t < 0) return;
	let n = 0;
	for (let r of e) {
		if (n === t) return r;
		n++;
	}
}
function kf(e, t, n) {
	if (t.parentKey === n.parentKey) return t.index - n.index;
	let r = [...Af(e, t), t], i = [...Af(e, n), n], a = r.slice(0, i.length).findIndex((e, t) => e !== i[t]);
	return a === -1 ? r.findIndex((e) => e === n) >= 0 ? 1 : (i.findIndex((e) => e === t), -1) : (t = r[a], n = i[a], t.index - n.index);
}
function Af(e, t) {
	let n = [], r = t;
	for (; r?.parentKey != null;) r = e.getItem(r.parentKey), r && n.unshift(r);
	return n;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/collections/getItemCount.mjs
var jf = /* @__PURE__ */ new WeakMap();
function Mf(e) {
	let t = jf.get(e);
	if (t != null) return t;
	let n = 0, r = (t) => {
		for (let i of t) i.type === "section" ? r(Ef(i, e)) : i.type === "item" && n++;
	};
	return r(e), jf.set(e, n), n;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/menu/useMenuItem.mjs
function Nf(e, t, n) {
	let { id: r, key: i, closeOnSelect: a, shouldCloseOnSelect: o, isVirtualized: s, "aria-haspopup": c, onPressStart: l, onPressUp: u, onPress: d, onPressChange: f, onPressEnd: p, onClick: m, onHoverStart: h, onHoverChange: g, onHoverEnd: v, onKeyDown: y, onKeyUp: b, onFocus: x, onFocusChange: S, onBlur: C, selectionManager: w = t.selectionManager } = e, T = !!c, ee = T && e["aria-expanded"] === "true", E = e.isDisabled ?? w.isDisabled(i), te = e.isSelected ?? w.isSelected(i), ne = tf.get(t), D = t.collection.getItem(i), re = e.onClose || ne.onClose, ie = Pa(), ae = () => {
		if (!T && (D?.props?.onAction ? D.props.onAction() : e.onAction && e.onAction(i), ne.onAction)) {
			let e = ne.onAction;
			e(i, D?.value);
		}
	}, oe = "menuitem";
	T || (w.selectionMode === "single" ? oe = "menuitemradio" : w.selectionMode === "multiple" && (oe = "menuitemcheckbox"));
	let se = Zr(), ce = Zr(), le = Zr(), ue = {
		id: r,
		"aria-disabled": E || void 0,
		role: oe,
		"aria-label": e["aria-label"],
		"aria-labelledby": se,
		"aria-describedby": [
			e["aria-describedby"],
			ce,
			le
		].filter(Boolean).join(" ") || void 0,
		"aria-controls": e["aria-controls"],
		"aria-haspopup": c,
		"aria-expanded": e["aria-expanded"]
	};
	if (w.selectionMode !== "none" && !T && (ue["aria-checked"] = te), s) {
		let e = Number(D?.index);
		ue["aria-posinset"] = Number.isNaN(e) ? void 0 : e + 1, ue["aria-setsize"] = Mf(t.collection);
	}
	let de = (0, _.useRef)(!1), fe = (e) => {
		f?.(e), de.current = e;
	}, pe = (0, _.useRef)(null), me = (e) => {
		e.pointerType !== "keyboard" && (pe.current = { pointerType: e.pointerType }), e.pointerType === "mouse" && (de.current || e.target.click()), u?.(e);
	}, he = (e) => {
		m?.(e), ae(), Ba(e, ie, D.props.href, D?.props.routerOptions);
		let t = pe.current?.pointerType === "keyboard" ? pe.current?.key === "Enter" || w.selectionMode === "none" || w.isLink(i) : w.selectionMode !== "multiple" || w.isLink(i);
		t = o ?? a ?? t, re && !T && t && re(), pe.current = null;
	}, { itemProps: ge, isFocused: _e } = Cf({
		id: r,
		selectionManager: w,
		key: i,
		ref: n,
		shouldSelectOnPressUp: !0,
		allowsDifferentPressOrigin: !0,
		linkBehavior: "none",
		shouldUseVirtualFocus: ne.shouldUseVirtualFocus
	}), { pressProps: ve, isPressed: ye } = Qo({
		onPressStart: l,
		onPress: d,
		onPressUp: me,
		onPressChange: fe,
		onPressEnd: p,
		isDisabled: E
	}), { hoverProps: be } = ms({
		isDisabled: E,
		onHoverStart(e) {
			!ro() && !(ee && c) && (w.setFocused(!0), w.setFocusedKey(i)), h?.(e);
		},
		onHoverChange: g,
		onHoverEnd: v
	}), { keyboardProps: xe } = Ao({
		shortcuts: {
			" ": (e) => {
				pe.current = {
					pointerType: "keyboard",
					key: " "
				}, L(e).click(), ao("keyboard");
			},
			Enter: (e) => {
				pe.current = {
					pointerType: "keyboard",
					key: "Enter"
				};
				let t = L(e);
				if (t.tagName !== "A") {
					t.click(), ao("keyboard");
					return;
				}
				return ao("keyboard"), {
					shouldPreventDefault: !1,
					shouldContinuePropagation: !1
				};
			}
		},
		onKeyDown: y,
		onKeyUp: b
	}), { focusableProps: Se } = Po({
		onBlur: C,
		onFocus: x,
		onFocusChange: S
	}, n), O = Ci(D?.props);
	delete O.id;
	let k = za(D?.props);
	return {
		menuItemProps: {
			...ue,
			...ni(O, k, T ? {
				onFocus: ge.onFocus,
				"data-collection": ge["data-collection"],
				"data-key": ge["data-key"]
			} : ge, ve, be, xe, Se, ne.shouldUseVirtualFocus || T ? { onMouseDown: (e) => e.preventDefault() } : void 0, E ? void 0 : { onClick: he }),
			tabIndex: ge.tabIndex != null && ee && !ne.shouldUseVirtualFocus ? -1 : ge.tabIndex
		},
		labelProps: { id: se },
		descriptionProps: { id: ce },
		keyboardShortcutProps: { id: le },
		isFocused: _e,
		isFocusVisible: _e && w.isFocused && ro() && !ee,
		isSelected: te,
		isPressed: ye,
		isDisabled: E
	};
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/menu/useMenuSection.mjs
function Pf(e) {
	let { heading: t, "aria-label": n } = e, r = Yr();
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/inertValue.mjs
function Ff(e) {
	let t = _.version.split(".");
	return parseInt(t[0], 10) >= 19 ? e : e ? "true" : void 0;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria/dist/private/utils/useLoadMoreSentinel.mjs
function If(e, t) {
	let { collection: n, onLoadMore: r, scrollOffset: i = 1, direction: a = "end" } = e, o = (0, _.useRef)(null), s = z((e) => {
		for (let t of e) t.isIntersecting && r && r();
	});
	P(() => {
		if (t.current) {
			let e = 100 * i, n = a === "start" ? `${e}% 0px 0px 0px` : `0px ${e}% ${e}% ${e}%`;
			o.current = new IntersectionObserver(s, {
				root: Xl(t?.current),
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/selection/Selection.mjs
var Lf = class e extends Set {
	constructor(t, n, r) {
		super(t), t instanceof e ? (this.anchorKey = n ?? t.anchorKey, this.currentKey = r ?? t.currentKey) : (this.anchorKey = n ?? null, this.currentKey = r ?? null);
	}
}, Rf = class e {
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
			(!e || n && kf(this.collection, n, e) < 0) && (e = n);
		}
		return e?.key ?? null;
	}
	get lastSelectedKey() {
		let e = null;
		for (let t of this.state.selectedKeys) {
			let n = this.collection.getItem(t);
			(!e || n && kf(this.collection, n, e) > 0) && (e = n);
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
		if (this.state.selectedKeys === "all") n = new Lf([t], t, t);
		else {
			let e = this.state.selectedKeys, r = e.anchorKey ?? t;
			n = new Lf(e, r, t);
			for (let i of this.getKeyRange(r, e.currentKey ?? t)) n.delete(i);
			for (let e of this.getKeyRange(t, r)) this.canSelectItem(e) && n.add(e);
		}
		this.state.setSelectedKeys(n);
	}
	getKeyRange(e, t) {
		let n = this.collection.getItem(e), r = this.collection.getItem(t);
		return n && r ? kf(this.collection, n, r) <= 0 ? this.getKeyRangeInternal(e, t) : this.getKeyRangeInternal(t, e) : [];
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
		let n = new Lf(this.state.selectedKeys === "all" ? this.getSelectAllKeys() : this.state.selectedKeys);
		n.has(t) ? n.delete(t) : this.canSelectItem(t) && (n.add(t), n.anchorKey = t, n.currentKey = t), !(this.disallowEmptySelection && n.size === 0) && this.state.setSelectedKeys(n);
	}
	replaceSelection(e) {
		if (this.selectionMode === "none") return;
		let t = this.getKey(e);
		if (t == null) return;
		let n = this.canSelectItem(t) ? new Lf([t], t, t) : new Lf();
		this.state.setSelectedKeys(n);
	}
	setSelectedKeys(e) {
		if (this.selectionMode === "none") return;
		let t = new Lf();
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
					i?.type === "item" && t.push(r), i?.hasChildNodes && (this.allowsCellSelection || i.type !== "item") && n(Df(Ef(i, e))?.key ?? null);
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
		!this.disallowEmptySelection && (this.state.selectedKeys === "all" || this.state.selectedKeys.size > 0) && this.state.setSelectedKeys(new Lf());
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
}, zf = class {
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
}, Bf = class {
	build(e, t) {
		return this.context = t, Vf(() => this.iterateCollection(e));
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
					wrapper: Hf(e.wrapper, a.wrapper)
				}, this.getChildState(t, a), n ? `${n}${i.key}` : i.key, r)];
				for (let t of u) {
					if (t.value = a.value ?? e.value ?? null, t.value && this.cache.set(t.value, t), e.type && t.type !== e.type) throw Error(`Unsupported type <${Uf(t.type)}> in <${Uf(r?.type ?? "unknown parent type")}>. Only <${Uf(e.type)}> is supported.`);
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
			childNodes: Vf(function* () {
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
function Vf(e) {
	let t = [], n = null;
	return { *[Symbol.iterator]() {
		for (let e of t) yield e;
		n ||= e();
		for (let e of n) t.push(e), yield e;
	} };
}
function Hf(e, t) {
	if (e && t) return (n) => e(t(n));
	if (e) return e;
	if (t) return t;
}
function Uf(e) {
	return e[0].toUpperCase() + e.slice(1);
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/collections/useCollection.mjs
function Wf(e, t, n) {
	let r = (0, _.useMemo)(() => new Bf(), []), { children: i, items: a, collection: o } = e;
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
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/selection/useMultipleSelectionState.mjs
function Gf(e, t) {
	if (e.size !== t.size) return !1;
	for (let n of e) if (!t.has(n)) return !1;
	return !0;
}
function Kf(e) {
	let { selectionMode: t = "none", disallowEmptySelection: n = !1, allowDuplicateSelectionEvents: r, selectionBehavior: i = "toggle", disabledBehavior: a = "all" } = e, o = (0, _.useRef)(!1), [, s] = (0, _.useState)(!1), c = (0, _.useRef)(null), l = (0, _.useRef)(null), [, u] = (0, _.useState)(null), [d, f] = Dc((0, _.useMemo)(() => qf(e.selectedKeys), [e.selectedKeys]), (0, _.useMemo)(() => qf(e.defaultSelectedKeys, new Lf()), [e.defaultSelectedKeys]), e.onSelectionChange), p = (0, _.useMemo)(() => e.disabledKeys ? new Set(e.disabledKeys) : /* @__PURE__ */ new Set(), [e.disabledKeys]), [m, h] = (0, _.useState)(i);
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
			(r || !Gf(e, d)) && f(e);
		},
		disabledKeys: p,
		disabledBehavior: a
	};
}
function qf(e, t) {
	return e ? e === "all" ? "all" : new Lf(e) : t;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-stately/dist/private/tree/useTreeState.mjs
function Jf(e) {
	let { onExpandedChange: t } = e, [n, r] = Dc(e.expandedKeys ? new Set(e.expandedKeys) : void 0, e.defaultExpandedKeys ? new Set(e.defaultExpandedKeys) : /* @__PURE__ */ new Set(), t), i = Kf(e), a = (0, _.useMemo)(() => e.disabledKeys ? new Set(e.disabledKeys) : /* @__PURE__ */ new Set(), [e.disabledKeys]), o = Wf(e, (0, _.useCallback)((e) => new zf(e, { expandedKeys: n }), [n]), null);
	return (0, _.useEffect)(() => {
		i.focusedKey != null && !o.getItem(i.focusedKey) && i.setFocusedKey(null);
	}, [o, i.focusedKey]), {
		collection: o,
		expandedKeys: n,
		disabledKeys: a,
		toggleKey: (e) => {
			r(Yf(n, e));
		},
		setExpandedKeys: r,
		selectionManager: new Rf(o, i)
	};
}
function Yf(e, t) {
	let n = new Set(e);
	return n.has(t) ? n.delete(t) : n.add(t), n;
}
//#endregion
//#region ../../../../../Documents/Codex/2026-10-01/task-18/node_modules/react-aria-components/dist/private/Menu.mjs
var Xf = /*#__PURE__*/ (0, _.createContext)(null), Zf = /*#__PURE__*/ (0, _.createContext)(null), H = /*#__PURE__*/ (0, _.createContext)(null), Qf = /*#__PURE__*/ (0, _.createContext)(null);
function $f(e) {
	let t = sd(e), n = (0, _.useRef)(null), { menuTriggerProps: r, menuProps: i } = ef({
		...e,
		type: "menu"
	}, t, n), a = (0, _.useRef)(null);
	return gi() ? null : /*#__PURE__*/ _.createElement(ai, { values: [
		[Xf, {
			...i,
			ref: a
		}],
		[V, t],
		[H, t],
		[nd, {
			trigger: "MenuTrigger",
			triggerRef: n,
			scrollRef: a,
			placement: "bottom start",
			"aria-labelledby": i["aria-labelledby"],
			offset: e.trigger === "contextMenu" ? 0 : void 0
		}]
	] }, /*#__PURE__*/ _.createElement(Ku, {
		...r,
		ref: n,
		isPressed: t.isOpen
	}, e.children));
}
var ep = /*#__PURE__*/ (0, _.createContext)(null);
(class extends ys {
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
var tp = /*#__PURE__*/ (0, _.forwardRef)(function(e, t) {
	return [e, t] = ci(e, t, Xf), /*#__PURE__*/ _.createElement(Is, { content: /*#__PURE__*/ _.createElement(Js, e) }, (n) => /*#__PURE__*/ _.createElement(np, {
		props: e,
		collection: n,
		menuRef: t
	}));
});
function np({ props: e, collection: t, menuRef: n }) {
	[e, n] = ci(e, n, Oc);
	let { filter: r, ...i } = e, a = (0, _.useMemo)(() => r ? t.filter(r) : t, [t, r]), o = Jf({
		...e,
		collection: a,
		children: void 0
	}), s = (0, _.useContext)(H), { isVirtualized: c, CollectionRoot: l } = (0, _.useContext)(ec), { menuProps: u } = Sf({
		...e,
		isVirtualized: c,
		onClose: e.onClose || s?.close
	}, o, n), d = oi({
		...e,
		children: void 0,
		defaultClassName: "react-aria-Menu",
		values: { isEmpty: o.collection.size === 0 }
	}), f = null;
	o.collection.size === 0 && e.renderEmptyState && (f = /*#__PURE__*/ _.createElement("div", {
		role: "menuitem",
		style: { display: "contents" }
	}, e.renderEmptyState()));
	let p = Ci(e, { global: !0 });
	return /*#__PURE__*/ _.createElement(xl, null, /*#__PURE__*/ _.createElement(fi.div, {
		...ni(p, d, u),
		ref: n,
		slot: e.slot || void 0,
		"data-empty": o.collection.size === 0 || void 0,
		onScroll: e.onScroll
	}, /*#__PURE__*/ _.createElement(ai, { values: [
		[Zf, o],
		[dd, { elementType: "div" }],
		[Xs, {
			name: "MenuSection",
			render: ip
		}],
		[ep, {
			parentMenuRef: n,
			shouldUseVirtualFocus: i?.shouldUseVirtualFocus
		}],
		[op, { shouldCloseOnSelect: e.shouldCloseOnSelect }],
		[Oc, null],
		[kc, null],
		[Qf, o.selectionManager],
		[H, s ?? sd({})]
	] }, /*#__PURE__*/ _.createElement(ld, null, /*#__PURE__*/ _.createElement(l, {
		collection: o.collection,
		persistedKeys: tc(o.selectionManager.focusedKey),
		scrollRef: n
	}))), f));
}
var rp = class extends Rf {
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
function ip(e, t, n, r = "react-aria-MenuSection") {
	let i = (0, _.useContext)(Zf), { CollectionBranch: a } = (0, _.useContext)(ec), [o, s] = li(), { headingProps: c, groupProps: l } = Pf({
		heading: s,
		"aria-label": n.props["aria-label"] ?? void 0
	}), u = oi({
		...e,
		id: void 0,
		children: void 0,
		defaultClassName: r,
		className: n.props?.className,
		style: n.props?.style,
		values: void 0
	}), d = (0, _.useContext)(Qf), f = Kf(e), p = e.selectionMode == null ? d : new rp(d, f), m = si(op)?.shouldCloseOnSelect, h = Ci(e, { global: !0 });
	return delete h.id, /*#__PURE__*/ _.createElement(fi.section, {
		...ni(h, u, l),
		ref: t
	}, /*#__PURE__*/ _.createElement(ai, { values: [
		[Ac, {
			...c,
			ref: o
		}],
		[Qf, p],
		[op, { shouldCloseOnSelect: e.shouldCloseOnSelect ?? m }]
	] }, /*#__PURE__*/ _.createElement(a, {
		collection: i.collection,
		parent: n
	})));
}
var ap = /*#__PURE__*/ Gs(ws, ip), op = /*#__PURE__*/ (0, _.createContext)(null), sp = /*#__PURE__*/ Ws(Cs, function(e, t, n) {
	[e, t] = ci(e, t, op);
	let r = si(op)?.id, i = (0, _.useContext)(Zf), a = ri(t), o = (0, _.useContext)(Qf), { isVirtualized: s } = (0, _.useContext)(ec), { menuItemProps: c, labelProps: l, descriptionProps: u, keyboardShortcutProps: d, ...f } = Nf({
		...e,
		id: r,
		key: n.key,
		selectionManager: o,
		isVirtualized: s
	}, i, a), { hoverProps: p, isHovered: m } = ms({ isDisabled: f.isDisabled }), h = oi({
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
	}), g = e.href ? fi.a : fi.div, v = Ci(e, { global: !0 });
	return delete v.id, delete v.onClick, /*#__PURE__*/ _.createElement(g, {
		...ni(v, h, c, p),
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
	}, /*#__PURE__*/ _.createElement(ai, { values: [
		[od, { slots: {
			[ii]: l,
			label: l,
			description: u
		} }],
		[Mc, d],
		[ud, { isSelected: f.isSelected }]
	] }, h.children));
});
Ws(Ss, function(e, t, n) {
	let r = (0, _.useContext)(Zf), { isLoading: i, onLoadMore: a, scrollOffset: o, ...s } = e, c = (0, _.useRef)(null);
	If((0, _.useMemo)(() => ({
		onLoadMore: a,
		collection: r?.collection,
		sentinelRef: c,
		scrollOffset: o
	}), [
		a,
		o,
		r?.collection
	]), c);
	let l = oi({
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
		inert: Ff(!0)
	}, /*#__PURE__*/ _.createElement("div", {
		"data-testid": "loadMoreSentinel",
		ref: c,
		style: {
			position: "absolute",
			height: 1,
			width: 1
		}
	})), i && l.children && /*#__PURE__*/ _.createElement(_.Fragment, null, /*#__PURE__*/ _.createElement(fi.div, {
		...ni(Ci(e, { global: !0 }), { tabIndex: -1 }),
		...l,
		role: "menuitem",
		ref: t
	}, l.children)));
});
var cp = {
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
}, lp = [
	"simple",
	"guided",
	"books"
], up = ["en", "hi"];
function dp(e) {
	let t = M(), n = (t) => {
		let [n, r] = String(t).split(":", 2);
		n === "ws" && r ? e.onSwitchWorkspace?.(r) : n === "co" && r ? e.onSwitchCompany?.(r) : n === "view" && (r === "simple" || r === "guided" || r === "books") ? e.onSetView(r) : n === "lang" && (r === "en" || r === "hi") ? e.onSetLanguage(r) : n === "lock" ? e.onLock() : n === "about" && e.onAbout();
	}, r = e.views ?? lp;
	return /* @__PURE__ */ (0, j.jsxs)($f, { children: [/* @__PURE__ */ (0, j.jsxs)(gs, {
		className: [cp.trigger].join(" "),
		"aria-label": t("SH-06.open"),
		children: [/* @__PURE__ */ (0, j.jsxs)("span", {
			className: cp.name,
			children: [e.workspace.name, e.workspace.demo && /* @__PURE__ */ (0, j.jsxs)("span", {
				className: cp.demo,
				children: [" ", t("SH-06.demo")]
			})]
		}), /* @__PURE__ */ (0, j.jsx)("span", {
			className: cp.who,
			children: e.workspace.who
		})]
	}), /* @__PURE__ */ (0, j.jsx)(id, {
		className: [cp.popover].join(" "),
		placement: "top start",
		children: /* @__PURE__ */ (0, j.jsxs)(tp, {
			className: [cp.menu].join(" "),
			onAction: n,
			children: [
				e.onSwitchWorkspace && e.workspaces && e.workspaces.length > 1 && /* @__PURE__ */ (0, j.jsxs)(ap, {
					className: [cp.section].join(" "),
					children: [/* @__PURE__ */ (0, j.jsx)(jc, {
						className: cp.header,
						children: t("SH-06.workspaces")
					}), e.workspaces.map((e) => /* @__PURE__ */ (0, j.jsxs)(sp, {
						id: `ws:${e.id}`,
						className: [cp.item].join(" "),
						children: [e.name, /* @__PURE__ */ (0, j.jsxs)("span", {
							className: cp.demo,
							children: [" ", e.demo ? t("SH-06.demo") : t("SH-06.real")]
						})]
					}, e.id))]
				}),
				e.onSwitchCompany && e.companies && e.companies.length > 0 && /* @__PURE__ */ (0, j.jsxs)(ap, {
					className: [cp.section].join(" "),
					children: [
						/* @__PURE__ */ (0, j.jsx)(jc, {
							className: cp.header,
							children: t("SH-06.companies")
						}),
						e.companies.map((t) => /* @__PURE__ */ (0, j.jsx)(sp, {
							id: `co:${t.id}`,
							className: [cp.item, e.companyId === t.id ? cp.chosen : ""].join(" "),
							children: t.name
						}, t.id)),
						/* @__PURE__ */ (0, j.jsx)(sp, {
							id: "co:all",
							className: [cp.item, e.companyId === "all" ? cp.chosen : ""].join(" "),
							children: t("SH-06.companies.all")
						})
					]
				}),
				/* @__PURE__ */ (0, j.jsxs)(ap, {
					className: [cp.section].join(" "),
					children: [/* @__PURE__ */ (0, j.jsx)(jc, {
						className: cp.header,
						children: t("SH-06.view")
					}), r.map((n) => /* @__PURE__ */ (0, j.jsx)(sp, {
						id: `view:${n}`,
						className: [cp.item, e.view === n ? cp.chosen : ""].join(" "),
						children: t(`SH-06.view.${n}`)
					}, n))]
				}),
				/* @__PURE__ */ (0, j.jsxs)(ap, {
					className: [cp.section].join(" "),
					children: [/* @__PURE__ */ (0, j.jsx)(jc, {
						className: cp.header,
						children: t("SH-06.language")
					}), up.map((n) => /* @__PURE__ */ (0, j.jsx)(sp, {
						id: `lang:${n}`,
						className: [cp.item, e.language === n ? cp.chosen : ""].join(" "),
						children: /* @__PURE__ */ (0, j.jsx)("span", {
							lang: n,
							children: t(`SH-06.language.${n}`)
						})
					}, n))]
				}),
				/* @__PURE__ */ (0, j.jsxs)(ap, {
					className: [cp.section].join(" "),
					children: [/* @__PURE__ */ (0, j.jsx)(sp, {
						id: "lock",
						className: [cp.item].join(" "),
						children: t("SH-06.lock")
					}), /* @__PURE__ */ (0, j.jsx)(sp, {
						id: "about",
						className: [cp.item].join(" "),
						children: t("SH-06.about")
					})]
				})
			]
		})
	})] });
}
var fp = {
	stack: "_stack_eo4ru_1",
	banner: "_banner_eo4ru_5",
	text: "_text_eo4ru_15",
	action: "_action_eo4ru_20"
}, pp = [
	"driving",
	"demo-clock",
	"read-only",
	"sending-closed",
	"jobs-paused",
	"update-needed",
	"no-connection"
], mp = {
	driving: "SH-03.driving.action",
	"read-only": "SH-03.read-only.action",
	"sending-closed": "SH-03.sending-closed.action",
	"update-needed": "SH-03.update-needed.action"
};
function hp({ item: e }) {
	let t = M(), n = mp[e.kind];
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: fp.banner,
		role: "status",
		children: [/* @__PURE__ */ (0, j.jsx)("span", {
			className: fp.text,
			children: t(`SH-03.${e.kind}`, e.values)
		}), e.action && n && /* @__PURE__ */ (0, j.jsx)(Cr, {
			variant: "link",
			onClick: e.action.onPress,
			className: fp.action,
			children: t(n)
		})]
	});
}
function gp({ items: e }) {
	let t = [...e].sort((e, t) => pp.indexOf(e.kind) - pp.indexOf(t.kind));
	return t.length === 0 ? null : /* @__PURE__ */ (0, j.jsx)("div", {
		className: fp.stack,
		children: t.map((e) => /* @__PURE__ */ (0, j.jsx)(hp, { item: e }, e.kind))
	});
}
var _p = {
	sheet: "_sheet_1jt9z_1",
	top: "_top_1jt9z_12",
	kind: "_kind_1jt9z_21",
	back: "_back_1jt9z_25",
	close: "_close_1jt9z_26",
	title: "_title_1jt9z_31",
	body: "_body_1jt9z_39",
	actions: "_actions_1jt9z_47"
}, vp = (0, _.createContext)({
	setPrimary: () => {},
	setClose: () => {},
	setAdjacent: () => {}
});
function yp({ kind: e, position: t, title: n, back: r, onClose: i, onAdjacent: a, primary: o, actions: s, origin: c, corner: l, children: u }) {
	let d = M(), f = (0, _.useId)(), p = (0, _.useRef)(null), m = (0, _.useContext)(vp), h = (0, _.useRef)(c);
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
	]), /* @__PURE__ */ (0, j.jsxs)("section", {
		className: [_p.sheet, "m-sheet"].join(" "),
		"aria-labelledby": f,
		"data-region": "sheet",
		children: [
			/* @__PURE__ */ (0, j.jsxs)("div", {
				className: _p.top,
				children: [
					/* @__PURE__ */ (0, j.jsx)("span", {
						className: _p.kind,
						children: r ? /* @__PURE__ */ (0, j.jsx)(Cr, {
							variant: "link",
							onClick: r.onBack,
							className: _p.back,
							children: d("SHEET.back", { what: r.label })
						}) : t ? d("SHEET.position", {
							kind: e,
							index: t.index,
							total: t.total
						}) : e
					}),
					l,
					/* @__PURE__ */ (0, j.jsx)(Cr, {
						variant: "link",
						onClick: i,
						className: _p.close,
						children: d("SHEET.close")
					})
				]
			}),
			/* @__PURE__ */ (0, j.jsx)("h2", {
				id: f,
				ref: p,
				tabIndex: -1,
				className: _p.title,
				children: n
			}),
			/* @__PURE__ */ (0, j.jsx)("div", {
				className: _p.body,
				children: u
			}),
			(o || s) && /* @__PURE__ */ (0, j.jsxs)("div", {
				className: _p.actions,
				children: [o && /* @__PURE__ */ (0, j.jsx)(Cr, {
					variant: "filled",
					onClick: o.onPress,
					disabled: o.disabled,
					children: o.label
				}), s]
			})
		]
	});
}
var bp = {
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
function xp(e) {
	let [t, n] = (0, _.useState)(!1);
	return (0, _.useEffect)(() => {
		let t = window.matchMedia(e), r = () => n(t.matches);
		return r(), t.addEventListener("change", r), () => t.removeEventListener("change", r);
	}, [e]), t;
}
function Sp(e) {
	return mr.some((t) => t === e);
}
function Cp({ shell: e, address: t, onNavigate: n, counts: r, menu: i, banners: a = [], ask: o, status: s, statusSimple: c, wide: l = !1, sheet: u, onHelp: d, children: f }) {
	let p = M(), m = xp("(max-width: 1023px)"), h = (0, _.useRef)(null), g = (0, _.useRef)(null), v = (0, _.useRef)({
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
		for (let e of mr) t.querySelector(`[data-region="${e}"]`) && n.add(e);
		let r = (document.activeElement?.closest("[data-region]"))?.dataset.region, i = hr(Sp(r) ? r : null, n, e);
		if (!i) return;
		let a = t.querySelector(`[data-region="${i}"]`);
		if (!a) return;
		let o = a.querySelector("[data-region-entry]"), s = a.querySelector("input, button, a[href], summary, [tabindex=\"0\"], h2[tabindex=\"-1\"]");
		(o ?? s ?? a).focus();
	}, []), x = o.voice, S = x?.on === !0, C = Er(x);
	(0, _.useEffect)(() => {
		let t = (t) => {
			let r = pr(t);
			if (r) switch (r.kind) {
				case "ask":
					t.preventDefault(), g.current?.focus();
					break;
				case "place": {
					let i = or(e)[r.index];
					i && sr(e, i) && (t.preventDefault(), n({ place: i }));
					break;
				}
				case "escape":
					v.current.close && (t.preventDefault(), v.current.close());
					break;
				case "adjacent":
					v.current.adjacent && (t.preventDefault(), v.current.adjacent(r.delta));
					break;
				case "primary":
					fr(t, v.current.primary);
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
	return /* @__PURE__ */ (0, j.jsx)(vp.Provider, {
		value: y,
		children: /* @__PURE__ */ (0, j.jsxs)("div", {
			ref: h,
			className: [
				bp.frame,
				m ? bp.narrow : "",
				l ? bp.wide : "",
				u ? bp.withSheet : ""
			].filter(Boolean).join(" "),
			children: [/* @__PURE__ */ (0, j.jsx)(vr, {
				shell: e,
				address: t,
				onNavigate: n,
				counts: r,
				narrow: m,
				foot: /* @__PURE__ */ (0, j.jsx)(dp, { ...i })
			}), /* @__PURE__ */ (0, j.jsxs)("div", {
				className: bp.main,
				children: [/* @__PURE__ */ (0, j.jsxs)("div", {
					className: bp.pageCol,
					children: [
						/* @__PURE__ */ (0, j.jsx)("div", {
							className: bp.column,
							children: /* @__PURE__ */ (0, j.jsx)(gp, { items: a })
						}),
						/* @__PURE__ */ (0, j.jsx)("main", {
							className: [bp.page, bp.column].join(" "),
							tabIndex: -1,
							"aria-label": p("SH-01.region.page"),
							"data-region": "page",
							children: f
						}),
						/* @__PURE__ */ (0, j.jsxs)("div", {
							className: bp.column,
							children: [/* @__PURE__ */ (0, j.jsx)(Dr, {
								ref: g,
								...o,
								hold: C,
								simple: w
							}), /* @__PURE__ */ (0, j.jsx)(Ar, {
								status: s,
								view: e.view,
								onNavigate: n,
								simpleSentences: c
							})]
						})
					]
				}), u && /* @__PURE__ */ (0, j.jsx)("div", {
					className: bp.sheetCol,
					children: u
				})]
			})]
		})
	});
}
var wp = {
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
function Tp({ workspaceName: e, unlockControl: t, device: n, onRecoveryKit: r, wrong: i = !1, waitUntil: a }) {
	let o = M(), s = a === void 0 ? i ? o("SH-02.wrong") : void 0 : o("SH-02.wait", { time: a });
	return /* @__PURE__ */ (0, j.jsx)("main", {
		className: wp.lock,
		"aria-labelledby": "lock-title",
		children: /* @__PURE__ */ (0, j.jsxs)("div", {
			className: wp.form,
			children: [
				/* @__PURE__ */ (0, j.jsx)(_r, {}),
				/* @__PURE__ */ (0, j.jsx)("h1", {
					id: "lock-title",
					className: wp.title,
					children: o("SH-02.title", { workspace: e })
				}),
				/* @__PURE__ */ (0, j.jsx)("div", {
					className: wp.unlock,
					children: t
				}),
				s !== void 0 && /* @__PURE__ */ (0, j.jsx)("p", {
					className: wp.problem,
					role: "alert",
					children: s
				}),
				n && /* @__PURE__ */ (0, j.jsx)("div", {
					className: wp.actions,
					children: /* @__PURE__ */ (0, j.jsx)(Cr, {
						variant: "link",
						onClick: n.onUnlock,
						disabled: a !== void 0,
						children: o("SH-02.device", { device: n.name })
					})
				}),
				r && /* @__PURE__ */ (0, j.jsxs)("p", {
					className: wp.forgot,
					children: [/* @__PURE__ */ (0, j.jsx)(Cr, {
						variant: "link",
						onClick: r,
						children: o("SH-02.forgot")
					}), /* @__PURE__ */ (0, j.jsx)("span", { children: o("SH-02.forgot.note") })]
				}),
				/* @__PURE__ */ (0, j.jsx)("p", {
					className: wp.paused,
					children: o("SH-02.paused")
				})
			]
		})
	});
}
//#endregion
//#region app/ui/src/app/plural.ts
function Ep(e) {
	if (e === null || !/^\d+$/.test(e)) return 2;
	let t = e.replace(/^0+(?=\d)/, "");
	return t === "0" ? 0 : t === "1" ? 1 : 2;
}
var Dp = {
	label: "_label_9a4ch_1",
	amber: "_amber_9a4ch_10"
};
//#endregion
//#region app/ui/src/parts/Label.tsx
function Op({ kind: e, className: t }) {
	let n = M(), r = e === "guess" || e === "stale" || e === "late" ? Dp.amber : "";
	return /* @__PURE__ */ (0, j.jsx)("span", {
		className: [
			Dp.label,
			r,
			t
		].filter(Boolean).join(" "),
		children: n(`LABEL.${e}`)
	});
}
//#endregion
//#region app/ui/src/app/presentation.ts
function kp(e) {
	return e !== void 0 && e.kind !== "missing" && e.receiptId.length > 0;
}
function Ap(e) {
	return e.kind === "missing" ? e.missing : "unknown";
}
var jp = {
	figure: "_figure_qy1mi_1",
	row: "_row_qy1mi_9",
	tile: "_tile_qy1mi_10",
	big: "_big_qy1mi_11",
	button: "_button_qy1mi_13",
	missing: "_missing_qy1mi_28",
	asWritten: "_asWritten_qy1mi_34",
	label: "_label_qy1mi_40"
}, Mp = {
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
function Np({ missing: e, className: t }) {
	let n = M();
	return /* @__PURE__ */ (0, j.jsx)("span", {
		className: [jp.missing, t].filter(Boolean).join(" "),
		children: n(Mp[e])
	});
}
function Pp({ value: e, size: t = "row", onReceipt: n, tabStop: r = !0, statement: i, className: a }) {
	let o = M(), s = [
		jp.figure,
		jp[t],
		a
	].filter(Boolean).join(" ");
	return kp(e) ? /* @__PURE__ */ (0, j.jsxs)("span", {
		className: s,
		children: [
			/* @__PURE__ */ (0, j.jsx)("button", {
				type: "button",
				className: [jp.button, "fig"].join(" "),
				title: o("FIGURE.title", {
					exact: e.exact,
					receipt: e.receiptId
				}),
				"aria-label": e.spoken === void 0 ? void 0 : o("FIGURE.spoken", { spoken: e.spoken }),
				tabIndex: r ? 0 : -1,
				onClick: () => n(e.receiptId),
				children: e.display
			}),
			e.asWritten !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
				className: jp.asWritten,
				children: e.asWritten
			}),
			e.labels.map((e) => /* @__PURE__ */ (0, j.jsx)(Op, {
				kind: e,
				className: jp.label
			}, e)),
			i !== void 0 && /* @__PURE__ */ (0, j.jsx)(Op, {
				kind: i,
				className: jp.label
			})
		]
	}) : /* @__PURE__ */ (0, j.jsx)(Np, {
		missing: Ap(e),
		className: s
	});
}
var Fp = {
	state: "_state_1wqfm_1",
	p: "_p_1wqfm_8",
	note: "_note_1wqfm_12",
	code: "_code_1wqfm_18"
}, Ip = {
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
function Lp({ state: e, action: t, emptyKey: n = "ST.empty.review", className: r }) {
	let i = M(), a = [Fp.state, r].filter(Boolean).join(" "), o = t ? /* @__PURE__ */ (0, j.jsx)(Cr, {
		variant: "link",
		onClick: t.onPress,
		children: t.label
	}) : null;
	switch (e.kind) {
		case "ready": return null;
		case "loading": return /* @__PURE__ */ (0, j.jsxs)("p", {
			className: a,
			role: "status",
			children: [e.lastKnownAt === void 0 ? i("ST.loading") : i("ST.loading.lastKnown", { time: e.lastKnownAt }), e.reading !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
				className: Fp.note,
				children: i("ST.loading.reading", { what: e.reading })
			})]
		});
		case "empty": return /* @__PURE__ */ (0, j.jsxs)("p", {
			className: a,
			children: [
				i(n),
				" ",
				o
			]
		});
		case "partial": return /* @__PURE__ */ (0, j.jsxs)("p", {
			className: a,
			children: [/* @__PURE__ */ (0, j.jsx)(Np, { missing: e.missing }), e.detail !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
				className: Fp.note,
				children: e.detail
			})]
		});
		case "no-change": return /* @__PURE__ */ (0, j.jsx)("p", {
			className: a,
			children: e.since === void 0 ? i("ST.noChange.plain") : i("ST.noChange", { since: e.since })
		});
		case "not-enough": return /* @__PURE__ */ (0, j.jsxs)("p", {
			className: a,
			children: [
				e.monthsNotLoaded && e.monthsNotLoaded.exact !== null ? i("ST.notEnough", {
					count: Ep(e.monthsNotLoaded.exact),
					display: e.monthsNotLoaded.display
				}) : i("ST.notEnough.plain"),
				" ",
				o
			]
		});
		case "stale": return /* @__PURE__ */ (0, j.jsxs)("p", {
			className: a,
			children: [
				/* @__PURE__ */ (0, j.jsx)(Op, { kind: "stale" }),
				" ",
				/* @__PURE__ */ (0, j.jsx)("span", { children: i("ST.stale.since", { date: e.workedOutOn }) }),
				" ",
				t && /* @__PURE__ */ (0, j.jsx)(Cr, {
					variant: "link",
					onClick: t.onPress,
					children: i("ST.rebuild")
				})
			]
		});
		case "not-yet": return /* @__PURE__ */ (0, j.jsxs)("p", {
			className: a,
			children: [
				i("ST.notYet"),
				" ",
				/* @__PURE__ */ (0, j.jsx)("span", {
					className: Fp.note,
					children: i("ST.notYet.wanted")
				}),
				" ",
				o
			]
		});
		case "stopped-by-rule": return /* @__PURE__ */ (0, j.jsxs)("p", {
			className: a,
			children: [i("ST.rule", { rule: e.rule }), e.who !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
				className: Fp.note,
				children: i("ST.rule.who", { who: e.who })
			})]
		});
		case "failed": return /* @__PURE__ */ (0, j.jsxs)("div", {
			className: a,
			children: [
				e.what === void 0 ? /* @__PURE__ */ (0, j.jsx)("p", {
					className: Fp.p,
					children: i("ST.failed")
				}) : /* @__PURE__ */ (0, j.jsx)("p", {
					className: Fp.p,
					children: e.what
				}),
				e.means !== void 0 && /* @__PURE__ */ (0, j.jsx)("p", {
					className: Fp.p,
					children: e.means
				}),
				(e.action !== void 0 || o) && /* @__PURE__ */ (0, j.jsxs)("p", {
					className: Fp.p,
					children: [
						e.action,
						" ",
						o
					]
				}),
				/* @__PURE__ */ (0, j.jsx)("p", {
					className: [Fp.code, "fig"].join(" "),
					children: i("ST.failed.code", { code: e.code })
				})
			]
		});
		case "waiting-for-network": return /* @__PURE__ */ (0, j.jsx)("p", {
			className: a,
			role: "status",
			children: i("ST.network")
		});
		case "read-only": return /* @__PURE__ */ (0, j.jsx)("p", {
			className: a,
			children: e.holder === void 0 ? i("ST.readOnly.plain") : i("ST.readOnly", { holder: e.holder })
		});
		case "hidden": return /* @__PURE__ */ (0, j.jsxs)("p", {
			className: a,
			children: [i("ST.hidden"), e.rows !== void 0 && e.rows.exact !== null && /* @__PURE__ */ (0, j.jsx)("span", {
				className: Fp.note,
				children: i("ST.hidden.total", {
					count: Ep(e.rows.exact),
					display: e.rows.display
				})
			})]
		});
		case "refused": return /* @__PURE__ */ (0, j.jsx)("p", {
			className: a,
			children: i("ST.refused", { reason: e.reason })
		});
		case "locked": return /* @__PURE__ */ (0, j.jsx)("p", {
			className: a,
			children: i("ST.locked")
		});
		case "not-built": {
			let t = e.capability, n = t !== void 0 && t.state !== "live" ? t : void 0;
			return /* @__PURE__ */ (0, j.jsxs)("div", {
				className: a,
				children: [
					/* @__PURE__ */ (0, j.jsx)("p", {
						className: Fp.p,
						children: n?.expectedDay === void 0 ? i("ST.notBuilt") : i("ST.notBuilt.day", { day: n.expectedDay })
					}),
					n !== void 0 && /* @__PURE__ */ (0, j.jsx)("p", {
						className: [Fp.code, "fig"].join(" "),
						children: i("ST.boundary.reason", { code: n.reasonCode })
					}),
					n?.state === "partial" && /* @__PURE__ */ (0, j.jsxs)("p", {
						className: Fp.note,
						children: [
							/* @__PURE__ */ (0, j.jsx)(Op, { kind: "experimental" }),
							" ",
							i("ST.partial.label")
						]
					})
				]
			});
		}
		case "boundary-state": {
			let t = e.source, r = t.kind;
			return r === "ready" ? null : r === "empty" ? /* @__PURE__ */ (0, j.jsxs)("p", {
				className: a,
				children: [
					i(n),
					" ",
					o
				]
			}) : /* @__PURE__ */ (0, j.jsxs)("div", {
				className: a,
				role: r === "loading" || r === "network-waiting" ? "status" : void 0,
				children: [
					/* @__PURE__ */ (0, j.jsxs)("p", {
						className: Fp.p,
						children: [
							i(Ip[r]),
							" ",
							o
						]
					}),
					"asOf" in t && t.asOf !== null && /* @__PURE__ */ (0, j.jsx)("p", {
						className: [Fp.code, "fig"].join(" "),
						children: i("ST.boundary.asOf", { asOf: t.asOf })
					}),
					"reasonCode" in t && /* @__PURE__ */ (0, j.jsx)("p", {
						className: [Fp.code, "fig"].join(" "),
						children: i("ST.boundary.reason", { code: t.reasonCode })
					})
				]
			});
		}
	}
}
var Rp = {
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
function zp({ where: e, title: t, titleId: n, count: r, aside: i, top: a }) {
	return /* @__PURE__ */ (0, j.jsxs)("header", {
		className: Rp.header,
		children: [/* @__PURE__ */ (0, j.jsxs)("div", {
			className: Rp.whereLine,
			children: [/* @__PURE__ */ (0, j.jsx)("p", {
				className: Rp.where,
				children: e
			}), a]
		}), /* @__PURE__ */ (0, j.jsxs)("div", {
			className: Rp.titleLine,
			children: [/* @__PURE__ */ (0, j.jsxs)("h1", {
				id: n,
				className: Rp.title,
				children: [t, r && /* @__PURE__ */ (0, j.jsx)("span", {
					className: [Rp.count, "fig"].join(" "),
					children: r.display
				})]
			}), i && /* @__PURE__ */ (0, j.jsx)("div", {
				className: Rp.aside,
				children: i
			})]
		})]
	});
}
var Bp = {
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
function Vp({ open: e }) {
	return /* @__PURE__ */ (0, j.jsx)("svg", {
		className: [Bp.arrow, e ? Bp.arrowOpen : ""].join(" "),
		viewBox: "0 0 8 8",
		"aria-hidden": "true",
		focusable: "false",
		children: /* @__PURE__ */ (0, j.jsx)("path", {
			d: "M2.5 1.5 5 4 2.5 6.5",
			fill: "none",
			stroke: "currentColor",
			strokeWidth: "1.2",
			strokeLinecap: "round",
			strokeLinejoin: "round"
		})
	});
}
function Hp({ row: e, selected: t = !1, open: n = !1, tabStop: r, onOpen: i, onReceipt: a, onKeyDown: o, expansion: s, registerOrigin: c }) {
	let l = M(), u = /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)(xr, {
		mark: e.mark,
		wordsKey: e.markWordsKey
	}), /* @__PURE__ */ (0, j.jsxs)("span", {
		className: Bp.what,
		children: [
			/* @__PURE__ */ (0, j.jsx)("span", {
				className: Bp.title,
				children: e.what
			}),
			e.note !== void 0 && e.note.length > 0 && /* @__PURE__ */ (0, j.jsx)("span", {
				className: Bp.note,
				children: e.note
			}),
			e.asWritten !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
				className: [Bp.asWritten, "fig"].join(" "),
				children: e.asWritten
			}),
			e.owner !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
				className: Bp.note,
				children: l("EN.owner", { name: e.owner })
			})
		]
	})] });
	return /* @__PURE__ */ (0, j.jsxs)("li", {
		className: [
			Bp.row,
			t ? Bp.selected : "",
			n ? Bp.open : ""
		].filter(Boolean).join(" "),
		"data-row-id": e.id,
		children: [/* @__PURE__ */ (0, j.jsxs)("div", {
			className: Bp.line,
			children: [
				i ? /* @__PURE__ */ (0, j.jsx)("button", {
					type: "button",
					className: Bp.main,
					"data-row-main": "",
					tabIndex: r ? 0 : -1,
					"aria-expanded": s === void 0 ? void 0 : n,
					"aria-current": t ? "true" : void 0,
					onClick: (t) => i(e.id, t.currentTarget),
					onKeyDown: o,
					ref: (t) => c?.(e.id, t),
					children: u
				}) : /* @__PURE__ */ (0, j.jsx)("div", {
					className: [Bp.main, Bp.static].join(" "),
					children: u
				}),
				e.figure !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
					className: Bp.figure,
					"data-row-figure": "",
					children: /* @__PURE__ */ (0, j.jsx)(Pp, {
						value: e.figure,
						onReceipt: a,
						tabStop: i === void 0,
						statement: e.statement
					})
				}),
				/* @__PURE__ */ (0, j.jsx)("span", {
					className: Bp.arrowSlot,
					"aria-hidden": "true",
					children: i && /* @__PURE__ */ (0, j.jsx)(Vp, { open: n })
				})
			]
		}), n && s !== void 0 && /* @__PURE__ */ (0, j.jsx)("div", {
			className: Bp.expansion,
			children: s
		})]
	});
}
var Up = {
	list: "_list_utcc2_1",
	seeAll: "_seeAll_utcc2_8"
}, Wp = "[data-row-main]", Gp = "[data-row-figure] button";
function Kp({ rows: e, selectedId: t, openId: n, onOpen: r, opens: i, onReceipt: a, expansion: o, seeAll: s, labelledBy: c, registerOrigin: l, className: u }) {
	let d = M(), f = (0, _.useRef)(null), [p, m] = (0, _.useState)(void 0), h = (e) => r !== void 0 && (i === void 0 || i(e)), g = e.filter(h), v = g.some((e) => e.id === p) ? p : g[0]?.id, y = (e, t) => {
		let n = f.current;
		if (!n) return;
		let r = Array.from(n.querySelectorAll(Wp)), i = r[t(r.indexOf(e), r.length - 1)];
		i && (m(i.closest("li")?.dataset.rowId), i.focus());
	}, b = (e) => {
		if (e.target !== e.currentTarget) return;
		let t = e.currentTarget;
		if (e.key === "ArrowDown") e.preventDefault(), y(t, (e, t) => Math.min(e + 1, t));
		else if (e.key === "ArrowUp") e.preventDefault(), y(t, (e) => Math.max(e - 1, 0));
		else if (e.key === "Home") e.preventDefault(), y(t, () => 0);
		else if (e.key === "End") e.preventDefault(), y(t, (e, t) => t);
		else if (e.key === "ArrowRight") {
			let n = t.closest("li")?.querySelector(Gp);
			n && (e.preventDefault(), n.focus());
		}
	};
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: u,
		children: [/* @__PURE__ */ (0, j.jsx)("ul", {
			ref: f,
			className: Up.list,
			"aria-labelledby": c,
			onKeyDown: (e) => {
				if (e.key !== "ArrowLeft" || !(e.target instanceof HTMLElement) || !e.target.matches(Gp)) return;
				let t = e.target.closest("li")?.querySelector(Wp);
				t && (e.preventDefault(), t.focus());
			},
			children: e.map((e) => /* @__PURE__ */ (0, j.jsx)(Hp, {
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
		}), s && /* @__PURE__ */ (0, j.jsx)("div", {
			className: Up.seeAll,
			children: /* @__PURE__ */ (0, j.jsx)(Cr, {
				variant: "link",
				onClick: s.onPress,
				children: d("BTN.seeAll", { count: s.count })
			})
		})]
	});
}
//#endregion
//#region app/ui/src/parts/charts/scale.ts
function qp(e) {
	return /^-?\d+$/.test(e) ? BigInt(e) : null;
}
function Jp(e) {
	let t = null, n = null;
	for (let r of e) r !== null && ((t === null || r < t) && (t = r), (n === null || r > n) && (n = r));
	return t === null || n === null ? null : {
		min: t,
		max: n
	};
}
function Yp(e) {
	return {
		min: e.min < 0n ? e.min : 0n,
		max: e.max > 0n ? e.max : 0n
	};
}
var Xp = 1073741824, Zp = 1073741824n;
function Qp(e, t) {
	let n = (e < 0n ? 0n : e > t ? t : e) * Zp / t;
	return Number(n) / Xp;
}
function $p(e, t, n, r) {
	for (let e of [n, r]) if (!Number.isFinite(e)) throw RangeError("SCALE_NONFINITE_END");
	let i = t < e, a = i ? e - t : t - e;
	return (t) => {
		if (a === 0n) return n;
		let o = Qp(i ? e - t : t - e, a);
		return n * (1 - o) + r * o;
	};
}
function em(e) {
	let t = 0n;
	for (let n of e) if (n !== null) {
		if (n < 0n) return null;
		t += n;
	}
	if (t === 0n) return null;
	let n = t;
	return e.map((e) => e === null ? null : Qp(e, n));
}
function tm(e, t, n, r) {
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
var nm = {
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
function rm({ label: e, display: t, spoken: n, receiptId: r, onReceipt: i, children: a }) {
	let o = M(), s = o("CHART.open", {
		label: e,
		amount: n ?? t
	}), c = () => i(r);
	return /* @__PURE__ */ (0, j.jsxs)("g", {
		className: nm.mark,
		role: "button",
		tabIndex: 0,
		"aria-label": s,
		onClick: c,
		onKeyDown: (e) => {
			(e.key === "Enter" || e.key === " ") && (e.preventDefault(), c());
		},
		children: [/* @__PURE__ */ (0, j.jsx)("title", { children: o("CHART.hover", {
			label: e,
			amount: t
		}) }), a]
	});
}
function im({ cx: e, cy: t }) {
	return /* @__PURE__ */ (0, j.jsx)("rect", {
		className: nm.hit,
		x: e - 12,
		y: t - 12,
		width: 24,
		height: 24
	});
}
function am({ values: e }) {
	let t = M(), n = e.filter((e) => !kp(e.value));
	return n.length === 0 ? null : /* @__PURE__ */ (0, j.jsx)("p", {
		className: nm.missing,
		children: n.map((e) => /* @__PURE__ */ (0, j.jsx)("span", {
			className: nm.missingItem,
			children: t("CHART.missing", {
				label: e.label,
				words: t(Mp[Ap(e.value)])
			})
		}, e.id))
	});
}
function om({ values: e, onReceipt: t }) {
	return /* @__PURE__ */ (0, j.jsx)("ul", {
		className: nm.values,
		children: e.map((e) => /* @__PURE__ */ (0, j.jsxs)("li", {
			className: nm.valueItem,
			children: [/* @__PURE__ */ (0, j.jsx)("span", {
				className: nm.valueLabel,
				children: e.label
			}), /* @__PURE__ */ (0, j.jsx)(Pp, {
				value: e.value,
				onReceipt: t
			})]
		}, e.id))
	});
}
//#endregion
//#region app/ui/src/parts/charts/Columns.tsx
var sm = 18;
function cm({ chart: e, onReceipt: t, width: n = 200, height: r = 48, className: i }) {
	let a = Math.max(e.values.length, 1), o = e.values.map((e) => kp(e.value) ? qp(e.value.exact) : null), s = Yp(Jp(o) ?? {
		min: 0n,
		max: 0n
	}), c = $p(s.min, s.max, r, 0), l = c(0n), u = n / a, d = Math.min(24, u * .6), f = r + sm, p = Math.min(Math.max(l, 12), Math.max(r - 12, 12));
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: i,
		children: [/* @__PURE__ */ (0, j.jsxs)("svg", {
			className: nm.svg,
			viewBox: `0 0 ${n} ${f}`,
			width: n,
			height: f,
			role: "group",
			"aria-label": e.sentence,
			children: [/* @__PURE__ */ (0, j.jsx)("line", {
				className: nm.baseline,
				x1: 0,
				x2: n,
				y1: l,
				y2: l
			}), e.values.map((n, i) => {
				let a = u * i + u / 2, s = o[i] ?? null, m = i === e.values.length - 1, h = n.emphasis ?? m, g = /* @__PURE__ */ (0, j.jsx)("text", {
					className: [nm.label, h ? nm.labelInk : ""].join(" "),
					x: a,
					y: f - 4,
					textAnchor: "middle",
					children: n.label
				});
				if (!kp(n.value)) return /* @__PURE__ */ (0, j.jsxs)("g", { children: [n.outline ? /* @__PURE__ */ (0, j.jsx)("rect", {
					className: nm.outline,
					x: a - d / 2,
					y: 0,
					width: d,
					height: r,
					rx: 4
				}) : /* @__PURE__ */ (0, j.jsx)("line", {
					className: nm.gap,
					x1: a - d / 2,
					x2: a + d / 2,
					y1: l,
					y2: l
				}), g] }, n.id);
				let _ = s === null ? null : c(s), v = _ !== null && _ > l;
				return /* @__PURE__ */ (0, j.jsxs)(rm, {
					label: n.label,
					display: n.value.display,
					spoken: n.value.spoken,
					receiptId: n.value.receiptId,
					onReceipt: t,
					children: [
						_ !== null && /* @__PURE__ */ (0, j.jsx)("rect", {
							className: [
								nm.bar,
								h ? nm.ink : nm.dim,
								"m-grow"
							].join(" "),
							style: { transformOrigin: v ? "center top" : "center bottom" },
							x: a - d / 2,
							y: Math.min(_, l),
							width: d,
							height: Math.abs(_ - l),
							rx: 4
						}),
						/* @__PURE__ */ (0, j.jsx)(im, {
							cx: a,
							cy: p
						}),
						g
					]
				}, n.id);
			})]
		}), /* @__PURE__ */ (0, j.jsx)(am, { values: e.values })]
	});
}
//#endregion
//#region app/ui/src/parts/charts/Line.tsx
var lm = 18, um = 6;
function dm({ chart: e, onReceipt: t, width: n = 200, height: r = 48, className: i }) {
	let a = Math.max(e.values.length, 1), o = e.values.map((e) => kp(e.value) ? qp(e.value.exact) : null), s = Jp(o), c = s ? $p(s.min, s.max, r - um, um) : null, l = tm(0, Math.max(a - 1, 1), um, n - um), u = r + lm, d = o.map((e, t) => e === null || c === null ? null : {
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
	return p.length > 0 && f.push(p), /* @__PURE__ */ (0, j.jsxs)("div", {
		className: i,
		children: [/* @__PURE__ */ (0, j.jsxs)("svg", {
			className: nm.svg,
			viewBox: `0 0 ${n} ${u}`,
			width: n,
			height: u,
			role: "group",
			"aria-label": e.sentence,
			children: [
				f.map((e, t) => {
					let n = e[0];
					if (n === void 0) return null;
					if (e.length === 1) return n === m ? null : /* @__PURE__ */ (0, j.jsx)("circle", {
						className: nm.point,
						cx: n.x,
						cy: n.y
					}, t);
					let r = e.map((e, t) => `${t === 0 ? "M" : "L"}${e.x.toFixed(1)} ${e.y.toFixed(1)}`).join(" ");
					return /* @__PURE__ */ (0, j.jsx)("path", {
						className: [nm.line, "m-draw"].join(" "),
						d: r,
						pathLength: 1
					}, t);
				}),
				m !== null && /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)("circle", {
					className: nm.ring,
					cx: m.x,
					cy: m.y
				}), /* @__PURE__ */ (0, j.jsx)("circle", {
					className: nm.dot,
					cx: m.x,
					cy: m.y
				})] }),
				e.values.map((e, n) => {
					if (!kp(e.value)) return null;
					let i = d[n] ?? {
						x: l(n),
						y: r - um
					};
					return /* @__PURE__ */ (0, j.jsx)(rm, {
						label: e.label,
						display: e.value.display,
						spoken: e.value.spoken,
						receiptId: e.value.receiptId,
						onReceipt: t,
						children: /* @__PURE__ */ (0, j.jsx)(im, {
							cx: i.x,
							cy: i.y
						})
					}, e.id);
				}),
				/* @__PURE__ */ (0, j.jsx)("text", {
					className: nm.label,
					x: um,
					y: u - 4,
					textAnchor: "start",
					children: e.from
				}),
				/* @__PURE__ */ (0, j.jsx)("text", {
					className: [nm.label, nm.labelInk].join(" "),
					x: n - um,
					y: u - 4,
					textAnchor: "end",
					children: e.to
				})
			]
		}), /* @__PURE__ */ (0, j.jsx)(am, { values: e.values })]
	});
}
//#endregion
//#region app/ui/src/parts/charts/OrderedBar.tsx
var fm = 10, pm = 2, mm = 12, hm = [
	"r1",
	"r2",
	"r3",
	"r4"
], gm = ["r1", "r3"];
function _m(e, t) {
	let n = t - 1 - e, r = t === 2 ? gm : hm;
	return r[Math.min(n, r.length - 1)] ?? "r1";
}
function vm({ chart: e, onReceipt: t, width: n = 200, className: r }) {
	let i = M(), a = e.values.length, o = e.values.map((e) => kp(e.value) ? qp(e.value.exact) : null), s = e.values.some((e, t) => {
		let n = o[t] ?? null;
		return kp(e.value) && (n === null || n < 0n);
	}), c = s ? null : em(o);
	if (c === null) return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: r,
		role: "group",
		"aria-label": e.sentence,
		children: [s && /* @__PURE__ */ (0, j.jsx)("p", {
			className: nm.unavailable,
			children: i("CHART.shares.unavailable")
		}), /* @__PURE__ */ (0, j.jsx)(om, {
			values: e.values,
			onReceipt: t
		})]
	});
	let l = e.values.filter((e) => !kp(e.value)).length, u = Math.max(n - pm * Math.max(a - 1, 0) - mm * l, 0), d = fm / 2, f = 0;
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: r,
		children: [/* @__PURE__ */ (0, j.jsx)("svg", {
			className: nm.svg,
			viewBox: `0 0 ${n} 28`,
			width: n,
			height: 28,
			role: "group",
			"aria-label": e.sentence,
			children: e.values.map((e, r) => {
				let i = c[r] ?? null, o = i === null ? mm : u * i, s = f;
				f += o + pm;
				let l = _m(r, a), p = r === 0 ? "start" : r === a - 1 ? "end" : "middle", m = r === 0 ? 0 : r === a - 1 ? n : s + o / 2;
				return !kp(e.value) || i === null ? /* @__PURE__ */ (0, j.jsxs)("g", { children: [/* @__PURE__ */ (0, j.jsx)("line", {
					className: nm.gap,
					x1: s,
					x2: s + o,
					y1: d,
					y2: d
				}), /* @__PURE__ */ (0, j.jsx)("text", {
					className: nm.label,
					x: m,
					y: 24,
					textAnchor: p,
					children: e.label
				})] }, e.id) : /* @__PURE__ */ (0, j.jsxs)(rm, {
					label: e.label,
					display: e.value.display,
					spoken: e.value.spoken,
					receiptId: e.value.receiptId,
					onReceipt: t,
					children: [
						o > 0 && /* @__PURE__ */ (0, j.jsx)("rect", {
							className: [
								nm.segment,
								nm[l],
								"m-grow-across"
							].join(" "),
							x: s,
							y: 0,
							width: o,
							height: fm
						}),
						/* @__PURE__ */ (0, j.jsx)(im, {
							cx: s + o / 2,
							cy: d
						}),
						/* @__PURE__ */ (0, j.jsx)("text", {
							className: [nm.label, l === "r1" ? nm.labelInk : ""].join(" "),
							x: m,
							y: 24,
							textAnchor: p,
							children: e.label
						})
					]
				}, e.id);
			})
		}), /* @__PURE__ */ (0, j.jsx)(am, { values: e.values })]
	});
}
//#endregion
//#region app/ui/src/parts/charts/Chart.tsx
function ym({ chart: e, onReceipt: t, width: n, height: r, className: i }) {
	switch (e.form) {
		case "columns": return /* @__PURE__ */ (0, j.jsx)(cm, {
			chart: e,
			onReceipt: t,
			width: n,
			height: r,
			className: i
		});
		case "line": return /* @__PURE__ */ (0, j.jsx)(dm, {
			chart: e,
			onReceipt: t,
			width: n,
			height: r,
			className: i
		});
		case "ordered-bar": return /* @__PURE__ */ (0, j.jsx)(vm, {
			chart: e,
			onReceipt: t,
			width: n,
			className: i
		});
	}
}
var bm = {
	stat: "_stat_l7cap_1",
	label: "_label_l7cap_7",
	figureLine: "_figureLine_l7cap_12",
	change: "_change_l7cap_19",
	chart: "_chart_l7cap_24",
	unavailable: "_unavailable_l7cap_29"
}, xm = {
	CHART_NOT_PROVIDED: "CHART.unavailable.CHART_NOT_PROVIDED",
	CHART_FORM_NOT_IMPLEMENTED: "CHART.unavailable.CHART_FORM_NOT_IMPLEMENTED",
	CHART_HAS_NO_POINTS: "CHART.unavailable.CHART_HAS_NO_POINTS",
	CHART_HAS_NO_KNOWN_POINTS: "CHART.unavailable.CHART_HAS_NO_KNOWN_POINTS"
};
function Sm({ tile: e, onReceipt: t, chartWidth: n, chartHeight: r, className: i }) {
	let a = M(), o = e.chartState.state === "missing" ? e.chartState.reasonCode : e.chart === void 0 ? "CHART_NOT_PROVIDED" : null;
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: [bm.stat, i].filter(Boolean).join(" "),
		children: [
			/* @__PURE__ */ (0, j.jsx)("span", {
				className: bm.label,
				children: e.label
			}),
			/* @__PURE__ */ (0, j.jsxs)("span", {
				className: bm.figureLine,
				children: [
					/* @__PURE__ */ (0, j.jsx)(Pp, {
						value: e.figure,
						size: "tile",
						onReceipt: t
					}),
					e.changeLabel !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
						className: bm.change,
						children: e.changeLabel
					}),
					e.change !== void 0 && /* @__PURE__ */ (0, j.jsx)(Pp, {
						value: e.change,
						onReceipt: t,
						className: bm.change
					})
				]
			}),
			o === null && e.chart !== void 0 ? /* @__PURE__ */ (0, j.jsx)(ym, {
				chart: e.chart,
				onReceipt: t,
				width: n,
				height: r,
				className: bm.chart
			}) : /* @__PURE__ */ (0, j.jsx)("p", {
				className: bm.unavailable,
				children: a(xm[o ?? "CHART_NOT_PROVIDED"])
			})
		]
	});
}
var Cm = {
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
function wm({ events: e, onReceipt: t, onOpenAll: n, labelledBy: r, className: i }) {
	let a = M(), o = e.slice(0, 6);
	return /* @__PURE__ */ (0, j.jsx)("ol", {
		className: [Cm.line, i].filter(Boolean).join(" "),
		"aria-labelledby": r,
		children: o.map((e, r) => {
			let i = /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [
				/* @__PURE__ */ (0, j.jsx)("span", {
					className: Cm.markRow,
					children: /* @__PURE__ */ (0, j.jsx)(xr, { mark: e.mark })
				}),
				/* @__PURE__ */ (0, j.jsx)("span", {
					className: [Cm.time, "fig"].join(" "),
					children: e.time
				}),
				/* @__PURE__ */ (0, j.jsx)("span", {
					className: Cm.words,
					children: e.words
				})
			] });
			return /* @__PURE__ */ (0, j.jsxs)("li", {
				className: Cm.mark,
				children: [
					n && r === o.length - 1 ? /* @__PURE__ */ (0, j.jsx)("button", {
						type: "button",
						className: Cm.button,
						onClick: n,
						children: i
					}) : /* @__PURE__ */ (0, j.jsx)("span", {
						className: Cm.static,
						children: i
					}),
					e.note !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
						className: Cm.note,
						children: e.note
					}),
					e.figure !== void 0 && /* @__PURE__ */ (0, j.jsx)(Pp, {
						value: e.figure,
						onReceipt: t,
						className: Cm.figure
					}),
					r === 0 && e.folded !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
						className: Cm.folded,
						children: a("TD-01.folded", { count: e.folded.display })
					})
				]
			}, e.id);
		})
	});
}
var Tm = {
	choice: "_choice_1xti7_1",
	label: "_label_1xti7_8",
	words: "_words_1xti7_13",
	word: "_word_1xti7_13",
	chosen: "_chosen_1xti7_34",
	pair: "_pair_1xti7_42"
};
//#endregion
//#region app/ui/src/parts/Choice.tsx
function Em({ label: e, labelHidden: t = !1, options: n, value: r, onChange: i, form: a = "words", disabled: o = !1, className: s }) {
	let c = (0, _.useId)();
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: [
			Tm.choice,
			Tm[a],
			s
		].filter(Boolean).join(" "),
		children: [/* @__PURE__ */ (0, j.jsx)("span", {
			id: c,
			className: t ? "sr" : Tm.label,
			children: e
		}), /* @__PURE__ */ (0, j.jsx)("div", {
			role: "radiogroup",
			"aria-labelledby": c,
			className: Tm.words,
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
				return /* @__PURE__ */ (0, j.jsx)("button", {
					type: "button",
					role: "radio",
					"aria-checked": t,
					tabIndex: t || r === null && e === n[0] ? 0 : -1,
					disabled: o,
					className: [Tm.word, t ? Tm.chosen : ""].join(" "),
					onClick: () => i(e.value),
					children: e.label
				}, e.value);
			})
		})]
	});
}
//#endregion
//#region app/ui/src/patterns/Lens.tsx
var Dm = [
	"whole-group",
	"finance",
	"sales",
	"operations"
];
function Om({ value: e, onChange: t, className: n }) {
	let r = M();
	return /* @__PURE__ */ (0, j.jsx)(Em, {
		label: r("EN.lens"),
		labelHidden: !0,
		options: Dm.map((e) => ({
			value: e,
			label: r(`EN.lens.${e}`)
		})),
		value: e,
		onChange: t,
		className: n
	});
}
var km = {
	field: "_field_6mo0j_1",
	label: "_label_6mo0j_8",
	line: "_line_6mo0j_13",
	prefix: "_prefix_6mo0j_20",
	input: "_input_6mo0j_24",
	problem: "_problem_6mo0j_42"
};
//#endregion
//#region app/ui/src/parts/Field.tsx
function Am({ label: e, problem: t, prefix: n, className: r, ...i }) {
	let a = (0, _.useId)(), o = `${a}-problem`;
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: [km.field, r].filter(Boolean).join(" "),
		children: [
			/* @__PURE__ */ (0, j.jsx)("label", {
				htmlFor: a,
				className: km.label,
				children: e
			}),
			/* @__PURE__ */ (0, j.jsxs)("div", {
				className: km.line,
				children: [n !== void 0 && /* @__PURE__ */ (0, j.jsx)("span", {
					className: [km.prefix, "fig"].join(" "),
					"aria-hidden": "true",
					children: n
				}), /* @__PURE__ */ (0, j.jsx)("input", {
					id: a,
					className: km.input,
					"aria-invalid": t ? !0 : void 0,
					"aria-describedby": t ? o : void 0,
					...i
				})]
			}),
			t && /* @__PURE__ */ (0, j.jsx)("p", {
				id: o,
				className: km.problem,
				children: t
			})
		]
	});
}
//#endregion
//#region app/ui/src/screens/today/permissions.ts
function jm(e) {
	return e.kind !== "read-only" && (e.kind !== "boundary-state" || e.source.kind !== "read-only");
}
function Mm(e, t) {
	return jm(e) ? t : {
		...t,
		onPrepare: void 0,
		onResumeSetup: void 0,
		onUpdate: void 0,
		onSaveClosing: void 0
	};
}
//#endregion
//#region app/ui/src/screens/today/shared.tsx
var Nm = "system:setup", Pm = "system:update";
function Fm(e, t) {
	let n = M(), r = [];
	if (e.setup) {
		let i = e.setup.can?.includes("continue") === !0 && t.onResumeSetup !== void 0;
		r.push({
			id: Nm,
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
			id: Pm,
			mark: "wait",
			what: n("TD-01.update"),
			can: i ? ["open"] : []
		});
	}
	return r;
}
function Im(e, t) {
	let n = [...t, ...e.review.rows].slice(0, 4);
	return {
		review: n,
		worth: (e.worthALook ?? []).slice(0, Math.max(0, 5 - n.length))
	};
}
function Lm(e) {
	return e.detail !== void 0 && e.detail.length > 0 || e.can !== void 0 && e.can.length > 0;
}
function Rm({ row: e, intents: t, origin: n }) {
	let r = M(), i = e.can ?? [], a = t.onResumeSetup, o = t.onUpdate, s = t.onPrepare, c = t.onOpenRow;
	return e.id === Nm ? /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)("span", {}), i.includes("open") && a && /* @__PURE__ */ (0, j.jsx)(Cr, {
		variant: "filled",
		onClick: () => a(),
		children: r("BTN.continue")
	})] }) : e.id === Pm ? /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)("span", {}), i.includes("open") && o && /* @__PURE__ */ (0, j.jsx)(Cr, {
		variant: "filled",
		onClick: () => o(),
		children: r("BTN.update")
	})] }) : /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)("span", { children: e.detail }), i.includes("review") ? /* @__PURE__ */ (0, j.jsx)(Cr, {
		variant: "filled",
		onClick: () => t.onReview(e.id, n),
		children: r("BTN.review")
	}) : i.includes("prepare") && s ? /* @__PURE__ */ (0, j.jsx)(Cr, {
		variant: "quiet",
		onClick: () => s(e.id),
		children: r("BTN.prepare")
	}) : i.includes("open") && c ? /* @__PURE__ */ (0, j.jsx)(Cr, {
		variant: "quiet",
		onClick: () => c(e.id, n),
		children: r("BTN.open")
	}) : null] });
}
function zm() {
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
var U = {
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
function Bm({ data: e, intents: t }) {
	let n = Mm(e.state, t), r = M(), i = (0, _.useId)(), a = (0, _.useId)(), [o, s] = (0, _.useState)(""), { review: c, worth: l } = Im(e, Fm(e, n)), u = zm(), d = n.onSaveClosing, f = (e) => /* @__PURE__ */ (0, j.jsx)(Rm, {
		row: e,
		intents: n,
		origin: u.originOf(e.id)
	}), p = (e) => {
		e.preventDefault();
		let t = o.trim();
		t.length !== 0 && d && (d(t), s(""));
	}, m = [...c, ...l];
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: U.today,
		children: [
			/* @__PURE__ */ (0, j.jsx)(zp, {
				where: e.date,
				title: r("TD-01.title"),
				titleId: i,
				count: e.review.count
			}),
			/* @__PURE__ */ (0, j.jsx)(Lp, { state: e.state }),
			m.length === 0 && e.state.kind === "ready" ? /* @__PURE__ */ (0, j.jsx)(Lp, {
				state: { kind: "empty" },
				emptyKey: "ST.empty.review"
			}) : /* @__PURE__ */ (0, j.jsx)(Kp, {
				rows: m,
				labelledBy: i,
				openId: u.openId,
				onOpen: (e) => u.toggle(e),
				opens: Lm,
				onReceipt: n.onReceipt,
				expansion: f,
				registerOrigin: u.registerOrigin,
				seeAll: e.review.total && n.onSeeAll ? {
					count: e.review.total.display,
					onPress: n.onSeeAll
				} : void 0
			}),
			e.cash && /* @__PURE__ */ (0, j.jsxs)("section", {
				className: U.cash,
				"aria-labelledby": a,
				children: [/* @__PURE__ */ (0, j.jsxs)("form", {
					className: U.cashForm,
					onSubmit: p,
					children: [/* @__PURE__ */ (0, j.jsx)("h2", {
						id: a,
						className: U.cashLabel,
						children: r("TD-02.cash")
					}), e.cash.entered ? /* @__PURE__ */ (0, j.jsx)("span", {
						className: U.cashEntered,
						children: /* @__PURE__ */ (0, j.jsx)(Pp, {
							value: e.cash.entered,
							size: "tile",
							onReceipt: n.onReceipt,
							statement: "told-by-owner"
						})
					}) : d ? /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)(Am, {
						label: r("TD-02.cash"),
						prefix: r("TD-02.cash.rupee"),
						inputMode: "numeric",
						value: o,
						onChange: (e) => s(e.target.value),
						className: U.cashField
					}), /* @__PURE__ */ (0, j.jsx)(Cr, {
						variant: "quiet",
						submit: !0,
						children: r("BTN.enter")
					})] }) : /* @__PURE__ */ (0, j.jsx)(Np, { missing: "cash-not-captured" })]
				}), /* @__PURE__ */ (0, j.jsx)(cm, {
					chart: e.cash.week,
					onReceipt: n.onReceipt,
					className: U.cashChart
				})]
			})
		]
	});
}
//#endregion
//#region app/ui/src/screens/today/TodayBooks.tsx
var Vm = "[data-queue-main]", Hm = "[data-queue-receipt] button";
function Um({ data: e, intents: t, sheetId: n }) {
	let r = Mm(e.state, t), i = jm(e.state), a = M(), o = (0, _.useId)(), s = (0, _.useId)(), c = (0, _.useRef)(null), [l, u] = (0, _.useState)(void 0), d = e.queue ?? [], f = r.onOpenQueueRow, p = d.some((e) => e.id === l) ? l : d[0]?.id, m = (e, t) => {
		let n = Array.from(c.current?.querySelectorAll(Vm) ?? []), r = n[n.indexOf(e) + t];
		r && (u(r.dataset.queueMain), r.focus());
	}, h = (e) => {
		if (e.target === e.currentTarget) {
			if (e.key === "ArrowDown") e.preventDefault(), m(e.currentTarget, 1);
			else if (e.key === "ArrowUp") e.preventDefault(), m(e.currentTarget, -1);
			else if (e.key === "ArrowRight") {
				let t = e.currentTarget.closest("tr")?.querySelector(Hm);
				t && (e.preventDefault(), t.focus());
			}
		}
	};
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: U.today,
		children: [
			/* @__PURE__ */ (0, j.jsx)(zp, {
				where: e.date,
				title: a("TD-01.title"),
				titleId: o,
				count: e.review.count
			}),
			/* @__PURE__ */ (0, j.jsx)(Lp, { state: e.state }),
			d.length === 0 && e.state.kind === "ready" ? /* @__PURE__ */ (0, j.jsx)(Lp, {
				state: { kind: "empty" },
				emptyKey: "ST.empty.review"
			}) : /* @__PURE__ */ (0, j.jsxs)("table", {
				className: U.table,
				"aria-labelledby": o,
				children: [/* @__PURE__ */ (0, j.jsx)("thead", { children: /* @__PURE__ */ (0, j.jsxs)("tr", { children: [
					/* @__PURE__ */ (0, j.jsx)("th", {
						scope: "col",
						className: U.thMark,
						children: /* @__PURE__ */ (0, j.jsx)("span", {
							className: "sr",
							children: a("TD-03.col.state")
						})
					}),
					/* @__PURE__ */ (0, j.jsx)("th", {
						scope: "col",
						children: a("TD-03.col.what")
					}),
					/* @__PURE__ */ (0, j.jsx)("th", {
						scope: "col",
						children: a("TD-03.col.party")
					}),
					/* @__PURE__ */ (0, j.jsx)("th", {
						scope: "col",
						children: a("TD-03.col.asWritten")
					}),
					/* @__PURE__ */ (0, j.jsx)("th", {
						scope: "col",
						className: U.num,
						children: a("TD-03.col.amount")
					}),
					/* @__PURE__ */ (0, j.jsx)("th", {
						scope: "col",
						children: a("TD-03.col.since")
					}),
					/* @__PURE__ */ (0, j.jsx)("th", {
						scope: "col",
						className: U.end,
						children: a("TD-03.col.then")
					})
				] }) }), /* @__PURE__ */ (0, j.jsx)("tbody", {
					ref: c,
					onKeyDown: (e) => {
						if (e.key !== "ArrowLeft" || !(e.target instanceof HTMLElement) || !e.target.matches(Hm)) return;
						let t = e.target.closest("tr")?.querySelector(Vm);
						t && (e.preventDefault(), t.focus());
					},
					children: d.map((e) => /* @__PURE__ */ (0, j.jsxs)("tr", {
						"aria-current": e.id === n ? "true" : void 0,
						className: e.id === n ? U.selected : "",
						children: [
							/* @__PURE__ */ (0, j.jsx)("td", {
								className: U.tdMark,
								children: /* @__PURE__ */ (0, j.jsx)(xr, {
									mark: e.mark,
									wordsKey: e.markWordsKey
								})
							}),
							/* @__PURE__ */ (0, j.jsx)("th", {
								scope: "row",
								children: f ? /* @__PURE__ */ (0, j.jsx)("button", {
									type: "button",
									className: U.queueMain,
									"data-queue-main": e.id,
									tabIndex: e.id === p ? 0 : -1,
									onKeyDown: h,
									onClick: (t) => f(e.id, t.currentTarget),
									children: e.what
								}) : e.what
							}),
							/* @__PURE__ */ (0, j.jsx)("td", { children: e.party === void 0 ? e.partyMissing === void 0 ? null : /* @__PURE__ */ (0, j.jsx)(Np, { missing: e.partyMissing }) : e.party }),
							/* @__PURE__ */ (0, j.jsx)("td", {
								className: [U.asWritten, "fig"].join(" "),
								children: e.asWritten
							}),
							/* @__PURE__ */ (0, j.jsx)("td", {
								className: U.num,
								"data-queue-receipt": "",
								children: e.amount !== void 0 && /* @__PURE__ */ (0, j.jsx)(Pp, {
									value: e.amount,
									onReceipt: r.onReceipt,
									tabStop: f === void 0
								})
							}),
							/* @__PURE__ */ (0, j.jsx)("td", {
								className: U.since,
								children: e.since
							}),
							/* @__PURE__ */ (0, j.jsx)("td", {
								className: [U.end, U.then].join(" "),
								children: a(`TD-03.then.${e.then}`)
							})
						]
					}, e.id))
				})]
			}),
			e.close && /* @__PURE__ */ (0, j.jsxs)("section", {
				className: U.section,
				"aria-labelledby": s,
				children: [/* @__PURE__ */ (0, j.jsx)("h2", {
					id: s,
					className: U.label,
					children: a("TD-03.close", { month: e.close.month })
				}), /* @__PURE__ */ (0, j.jsx)("ul", {
					className: U.close,
					children: e.close.steps.map((e) => /* @__PURE__ */ (0, j.jsxs)("li", {
						className: U.closeRow,
						children: [
							/* @__PURE__ */ (0, j.jsx)(xr, { mark: e.mark }),
							/* @__PURE__ */ (0, j.jsx)("span", {
								className: U.closeName,
								children: e.name
							}),
							/* @__PURE__ */ (0, j.jsx)("span", {
								className: [U.closeStatus, e.statusMono ? "fig" : ""].join(" "),
								children: e.status
							}),
							/* @__PURE__ */ (0, j.jsx)("span", {
								className: U.closeEnd,
								children: e.chart ? /* @__PURE__ */ (0, j.jsx)(ym, {
									chart: e.chart,
									onReceipt: r.onReceipt
								}) : i && e.action ? /* @__PURE__ */ (0, j.jsx)(Cr, {
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
function Wm(e) {
	return e.view === "simple" ? /* @__PURE__ */ (0, j.jsx)(Bm, { ...e }) : e.view === "books" ? /* @__PURE__ */ (0, j.jsx)(Um, { ...e }) : /* @__PURE__ */ (0, j.jsx)(Gm, { ...e });
}
function Gm({ data: e, intents: t }) {
	let n = Mm(e.state, t), r = M(), i = (0, _.useId)(), a = (0, _.useId)(), o = (0, _.useId)(), s = (0, _.useId)(), c = (0, _.useId)(), { review: l, worth: u } = Im(e, Fm(e, n)), d = zm(), f = e.enterprise, p = n.onOpenRow, m = n.onLens, h = (e) => /* @__PURE__ */ (0, j.jsx)(Rm, {
		row: e,
		intents: n,
		origin: d.originOf(e.id)
	}), g = (e) => e.can?.includes("open") === !0, v = e.review.total && n.onSeeAll ? {
		count: e.review.total.display,
		onPress: n.onSeeAll
	} : void 0;
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: U.today,
		children: [
			/* @__PURE__ */ (0, j.jsx)(zp, {
				where: e.date,
				title: r("TD-01.title"),
				titleId: i,
				count: e.review.count,
				top: f && m ? /* @__PURE__ */ (0, j.jsx)(Om, {
					value: f.lens,
					onChange: m
				}) : void 0,
				aside: f && v ? /* @__PURE__ */ (0, j.jsx)(Cr, {
					variant: "link",
					onClick: v.onPress,
					children: r("BTN.seeAll", { count: v.count })
				}) : void 0
			}),
			/* @__PURE__ */ (0, j.jsx)(Lp, { state: e.state }),
			l.length === 0 && e.state.kind === "ready" ? /* @__PURE__ */ (0, j.jsx)(Lp, {
				state: { kind: "empty" },
				emptyKey: "ST.empty.review"
			}) : /* @__PURE__ */ (0, j.jsx)(Kp, {
				rows: l,
				labelledBy: i,
				openId: d.openId,
				onOpen: (e) => d.toggle(e),
				opens: Lm,
				onReceipt: n.onReceipt,
				expansion: h,
				registerOrigin: d.registerOrigin,
				seeAll: f ? void 0 : v
			}),
			u.length > 0 && /* @__PURE__ */ (0, j.jsxs)("section", {
				className: U.section,
				"aria-labelledby": a,
				children: [/* @__PURE__ */ (0, j.jsx)("h2", {
					id: a,
					className: U.label,
					children: r("TD-01.worth")
				}), /* @__PURE__ */ (0, j.jsx)(Kp, {
					rows: u,
					labelledBy: a,
					onOpen: p,
					opens: g,
					onReceipt: n.onReceipt
				})]
			}),
			/* @__PURE__ */ (0, j.jsxs)("section", {
				className: U.section,
				"aria-labelledby": o,
				children: [/* @__PURE__ */ (0, j.jsx)("h2", {
					id: o,
					className: U.label,
					children: r(f ? "EN.month" : "TD-01.month")
				}), e.thisMonth && e.thisMonth.length > 0 ? /* @__PURE__ */ (0, j.jsx)("div", {
					className: [U.tiles, e.thisMonth.length > 3 ? U.tilesFour : ""].join(" "),
					children: e.thisMonth.map((e) => /* @__PURE__ */ (0, j.jsx)(Sm, {
						tile: e,
						onReceipt: n.onReceipt
					}, e.id))
				}) : /* @__PURE__ */ (0, j.jsx)("p", {
					className: U.missing,
					children: /* @__PURE__ */ (0, j.jsx)(Np, { missing: e.thisMonthMissing ?? "not-loaded-yet" })
				})]
			}),
			f?.changedSince && /* @__PURE__ */ (0, j.jsxs)("section", {
				className: U.section,
				"aria-labelledby": s,
				children: [
					/* @__PURE__ */ (0, j.jsx)("h2", {
						id: s,
						className: U.label,
						children: r("EN.changed", { since: f.changedSince.since })
					}),
					/* @__PURE__ */ (0, j.jsx)(Kp, {
						rows: f.changedSince.rows,
						labelledBy: s,
						onOpen: p,
						opens: g,
						onReceipt: n.onReceipt
					}),
					f.quietLines && f.quietLines.length > 0 && /* @__PURE__ */ (0, j.jsx)("p", {
						className: U.quiet,
						children: f.quietLines.map((e, t) => /* @__PURE__ */ (0, j.jsx)("span", { children: e }, t))
					})
				]
			}),
			!f && /* @__PURE__ */ (0, j.jsxs)("section", {
				className: U.section,
				"aria-labelledby": c,
				children: [/* @__PURE__ */ (0, j.jsx)("h2", {
					id: c,
					className: U.label,
					children: r("TD-01.earlier")
				}), e.earlierToday && e.earlierToday.length > 0 ? /* @__PURE__ */ (0, j.jsx)(wm, {
					events: e.earlierToday,
					onReceipt: n.onReceipt,
					onOpenAll: n.onOpenActivity,
					labelledBy: c
				}) : /* @__PURE__ */ (0, j.jsx)("p", {
					className: U.missing,
					children: e.earlierTodayMissing === void 0 ? r("TD-01.earlier.none") : /* @__PURE__ */ (0, j.jsx)(Np, { missing: e.earlierTodayMissing })
				})]
			})
		]
	});
}
//#endregion
//#region app/ui/src/app/App.tsx
function Km() {
	return Vn(typeof window < "u" ? window.location.hash : "");
}
function qm({ locked: e }) {
	let t = M();
	return /* @__PURE__ */ (0, j.jsx)("main", {
		className: wp.lock,
		children: /* @__PURE__ */ (0, j.jsx)("div", {
			className: wp.form,
			children: /* @__PURE__ */ (0, j.jsx)("h1", {
				className: wp.title,
				children: t(e ? "ST.locked" : "ST.noAccess")
			})
		})
	});
}
function Jm(e) {
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
	]), [s, c] = (0, _.useState)(Km), l = lr(o, s), u = e.lock != null || dr(e.today.data.state), d = u || l === null ? null : Hn(l), f = (0, _.useMemo)(() => d === null ? null : Vn(d), [d]);
	(0, _.useEffect)(() => {
		let e = () => {
			let e = Km();
			c((t) => Un(t, e) ? t : e);
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
		let t = lr(o, e);
		t !== null && (Un(t, s) || (window.location.hash = Hn(t), c(t)));
	}, [s, o]);
	if (u) return /* @__PURE__ */ (0, j.jsx)(Pn, {
		language: e.language,
		children: e.lock ? /* @__PURE__ */ (0, j.jsx)(Tp, { ...e.lock }) : /* @__PURE__ */ (0, j.jsx)(qm, { locked: !0 })
	});
	if (l === null) return /* @__PURE__ */ (0, j.jsx)(Pn, {
		language: e.language,
		children: /* @__PURE__ */ (0, j.jsx)(qm, { locked: !1 })
	});
	let m = ur(l, e.sheet), h, g = !1;
	if (l.place === "today" && e.shellKind !== "ca-firm" && (l.sub === void 0 || l.sub === "today")) h = /* @__PURE__ */ (0, j.jsx)(Wm, {
		...e.today,
		view: e.view,
		sheetId: l.sheet,
		onNavigate: p
	}), g = e.view === "books" || e.shellKind === "enterprise";
	else {
		let t = e.renderPlace?.(l), n = e.capabilities[l.place];
		h = t ?? /* @__PURE__ */ (0, j.jsx)(Lp, { state: n === void 0 ? { kind: "not-built" } : {
			kind: "not-built",
			capability: n
		} });
	}
	return /* @__PURE__ */ (0, j.jsx)(Pn, {
		language: e.language,
		children: /* @__PURE__ */ (0, j.jsx)(Cp, {
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
var Ym = class extends Error {
	code = "INVALID_REPLY";
	path;
	constructor(e) {
		super("INVALID_REPLY"), this.name = "ReplyValidationError", this.path = e;
	}
};
function W(e) {
	throw new Ym(e);
}
function Xm(e, t) {
	(typeof e != "object" || !e || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype) && W(t), Object.getOwnPropertySymbols(e).length > 0 && W(t);
	for (let n of Object.values(Object.getOwnPropertyDescriptors(e))) (!Object.hasOwn(n, "value") || !n.enumerable) && W(t);
	return e;
}
function Zm(e, t, n, r = []) {
	let i = Xm(e, t);
	return (n.some((e) => !Object.hasOwn(i, e)) || Object.keys(i).some((e) => !n.includes(e) && !r.includes(e))) && W(t), Object.values(i).some((e) => e === void 0) && W(t), i;
}
function Qm(e, t, n = 8e3, r = !1) {
	(typeof e != "string" || e.length > n || !r && e.trim().length === 0 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(e)) && W(t);
}
function $m(e, t) {
	Qm(e, t, 200);
}
function eh(e, t, n) {
	(typeof e != "string" || !n.includes(e)) && W(t);
}
function th(e, t) {
	typeof e != "boolean" && W(t);
}
function nh(e, t, n = 2 ** 53 - 1) {
	(typeof e != "number" || !Number.isSafeInteger(e) || e < 0 || e > n) && W(t);
}
function rh(e, t = "integer", n = !0) {
	(typeof e != "string" || e.length > 256 || !(n ? /^-?\d+$/ : /^\d+$/).test(e)) && W(t);
}
function ih(e, t, n, r) {
	(!Array.isArray(e) || Object.getPrototypeOf(e) !== Array.prototype || e.length > n || Object.getOwnPropertySymbols(e).length > 0) && W(t);
	for (let [n, r] of Object.entries(Object.getOwnPropertyDescriptors(e))) (!Object.hasOwn(r, "value") || n !== "length" && !/^(?:0|[1-9]\d*)$/.test(n)) && W(t);
	for (let n = 0; n < e.length; n++) r(e[n], `${t}[${n}]`);
}
function ah(e, t, n) {
	Array.isArray(e) || W(t);
	let r = e.map((e) => n ? Xm(e, t)[n] : e);
	new Set(r).size !== r.length && W(t);
}
function oh(e, t = "date") {
	(typeof e != "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e)) && W(t);
	let n = /* @__PURE__ */ new Date(`${e}T00:00:00.000Z`);
	(!Number.isFinite(n.getTime()) || n.toISOString().slice(0, 10) !== e) && W(t);
}
function sh(e, t = "instant") {
	(typeof e != "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(e)) && W(t), oh(e.slice(0, 10), t);
	let n = Number(e.slice(11, 13)), r = Number(e.slice(14, 16)), i = Number(e.slice(17, 19));
	(n > 23 || r > 59 || i > 59 || !Number.isFinite(Date.parse(e))) && W(t);
	let a = e.match(/([+-])(\d{2}):(\d{2})$/);
	a && (Number(a[2]) > 23 || Number(a[3]) > 59) && W(t);
}
function ch(e, t) {
	typeof e == "string" && /^\d{4}-\d{2}-\d{2}$/.test(e) ? oh(e, t) : sh(e, t);
}
function lh(e, t, n) {
	e !== null && n(e, t);
}
var uh = [
	"cha",
	"you",
	"wait",
	"busy",
	"unsure",
	"guess",
	"off"
], dh = [
	"seed",
	"what-if",
	"projection",
	"from-outside",
	"approximate",
	"demo-clock",
	"stale"
], fh = [
	"absent",
	"null",
	"unknown",
	"withheld",
	"not-applicable",
	"not-loaded-yet",
	"not-counted"
], ph = [
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
function mh(e, t) {
	let n = Xm(e, t);
	if (eh(n.kind, `${t}.kind`, [
		"money",
		"count",
		"percent",
		"missing"
	]), n.kind === "missing") {
		Zm(e, t, ["kind", "state"]), eh(n.state, `${t}.state`, fh);
		return;
	}
	Zm(e, t, [
		"kind",
		"receiptId",
		"labels",
		...n.kind === "money" ? ["currency", "paise"] : n.kind === "count" ? ["count"] : ["basisPoints"]
	]), $m(n.receiptId, `${t}.receiptId`), ih(n.labels, `${t}.labels`, dh.length, (e, t) => eh(e, t, dh)), ah(n.labels, `${t}.labels`), n.kind === "money" ? (eh(n.currency, `${t}.currency`, ["INR"]), rh(n.paise, `${t}.paise`)) : n.kind === "count" ? rh(n.count, `${t}.count`, !1) : rh(n.basisPoints, `${t}.basisPoints`);
}
function hh(e, t) {
	let n = Zm(e, t, ["type", "address"]);
	eh(n.type, `${t}.type`, ["open-sheet"]), Qm(n.address, `${t}.address`, 300), /^#\/(?:today|ask|work|books|reports|tools|trust|company|clients|more)(?:\/[a-z][a-z0-9-]{0,63})?(?:\?sheet=[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199})?$/.exec(n.address)?.[0] !== n.address && W(`${t}.address`);
}
function gh(e, t) {
	let n = Zm(e, t, [
		"id",
		"mark",
		"title",
		"note"
	], ["figure", "action"]);
	$m(n.id, `${t}.id`), eh(n.mark, `${t}.mark`, uh), Qm(n.title, `${t}.title`), Qm(n.note, `${t}.note`, 8e3, !0), Object.hasOwn(n, "figure") && (mh(n.figure, `${t}.figure`), n.mark === "guess" && n.figure.kind !== "missing" && W(`${t}.figure`)), Object.hasOwn(n, "action") && hh(n.action, `${t}.action`);
}
function _h(e, t) {
	let n = Xm(e, t), r = [
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
	eh(n.kind, `${t}.kind`, [
		...r,
		...i,
		...a
	]), r.includes(String(n.kind)) ? Zm(e, t, ["kind"]) : i.includes(String(n.kind)) ? (Zm(e, t, [
		"kind",
		"asOf",
		"reasonCode"
	]), lh(n.asOf, `${t}.asOf`, ch), $m(n.reasonCode, `${t}.reasonCode`)) : (Zm(e, t, ["kind", "reasonCode"]), $m(n.reasonCode, `${t}.reasonCode`));
}
function vh(e, t) {
	let n = Zm(e, t, [
		"kind",
		"description",
		"points"
	]);
	eh(n.kind, `${t}.kind`, ph), Qm(n.description, `${t}.description`), ih(n.points, `${t}.points`, 120, (e, t) => {
		let n = Zm(e, t, [
			"id",
			"label",
			"value"
		]);
		$m(n.id, `${t}.id`), Qm(n.label, `${t}.label`), mh(n.value, `${t}.value`);
	}), ah(n.points, `${t}.points`, "id"), new Set(n.points.map((e) => e.value.kind).filter((e) => e !== "missing")).size > 1 && W(`${t}.points`);
}
function yh(e, t) {
	let n = Zm(e, t, [
		"title",
		"date",
		"pendingCount",
		"attention",
		"worthLook",
		"stats",
		"dayEvents",
		"state"
	]);
	if (Qm(n.title, `${t}.title`), oh(n.date, `${t}.date`), lh(n.pendingCount, `${t}.pendingCount`, (e, t) => rh(e, t, !1)), ih(n.attention, `${t}.attention`, 4, gh), ah(n.attention, `${t}.attention`, "id"), ih(n.worthLook, `${t}.worthLook`, 5, gh), ah(n.worthLook, `${t}.worthLook`, "id"), Array.isArray(n.attention) && Array.isArray(n.worthLook)) {
		n.attention.length + n.worthLook.length > 5 && W(`${t}.worthLook`);
		let e = [...n.attention, ...n.worthLook].map((e) => e.id);
		new Set(e).size !== e.length && W(`${t}.worthLook`);
	}
	ih(n.stats, `${t}.stats`, 12, (e, t) => {
		let n = Zm(e, t, [
			"id",
			"label",
			"figure",
			"chart"
		], ["change", "changeLabel"]);
		$m(n.id, `${t}.id`), Qm(n.label, `${t}.label`), mh(n.figure, `${t}.figure`), lh(n.chart, `${t}.chart`, vh), Object.hasOwn(n, "change") && mh(n.change, `${t}.change`), Object.hasOwn(n, "changeLabel") && (Qm(n.changeLabel, `${t}.changeLabel`), (!Object.hasOwn(n, "change") || /[\p{N}\u20b9%]/u.test(n.changeLabel)) && W(`${t}.changeLabel`));
	}), ah(n.stats, `${t}.stats`, "id"), ih(n.dayEvents, `${t}.dayEvents`, 6, (e, t) => {
		let n = Zm(e, t, [
			"id",
			"at",
			"mark",
			"label"
		], ["action"]);
		$m(n.id, `${t}.id`), sh(n.at, `${t}.at`), eh(n.mark, `${t}.mark`, uh), Qm(n.label, `${t}.label`), Object.hasOwn(n, "action") && hh(n.action, `${t}.action`);
	}), ah(n.dayEvents, `${t}.dayEvents`, "id"), _h(n.state, `${t}.state`), n.state.kind === "locked" && (n.pendingCount !== null || [
		n.attention,
		n.worthLook,
		n.stats,
		n.dayEvents
	].some((e) => e.length > 0)) && W(`${t}.state`);
}
function bh(e, t) {
	let n = Zm(e, t, ["from", "to"]);
	oh(n.from, `${t}.from`), oh(n.to, `${t}.to`), n.from > n.to && W(t);
}
function xh(e, t, n = 0) {
	if (n > 12 && W(t), e === null || typeof e == "boolean") return;
	if (typeof e == "string") {
		Qm(e, t, 1e5, !0);
		return;
	}
	if (typeof e == "number") {
		Number.isFinite(e) || W(t);
		return;
	}
	if (Array.isArray(e)) {
		ih(e, t, 1e4, (e, t) => xh(e, t, n + 1));
		return;
	}
	let r = Xm(e, t);
	Object.keys(r).length > 1e3 && W(t);
	for (let [e, i] of Object.entries(r)) [
		"__proto__",
		"prototype",
		"constructor"
	].includes(e) && W(t), xh(i, `${t}.${e}`, n + 1);
}
var Sh = [
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
function Ch(e, t) {
	let n = Zm(e, t, Sh, ["staleReason", "requestedSourceIds"]);
	for (let e of [
		"id",
		"memberId",
		"operation",
		"dictionaryHash",
		"definitionHash"
	]) $m(n[e], `${t}.${e}`);
	nh(n.epoch, `${t}.epoch`), nh(n.ontologyVersion, `${t}.ontologyVersion`), ih(n.sourceIds, `${t}.sourceIds`, 1e4, $m), ah(n.sourceIds, `${t}.sourceIds`), Object.hasOwn(n, "requestedSourceIds") && (ih(n.requestedSourceIds, `${t}.requestedSourceIds`, 64, (e, t) => {
		(typeof e != "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(e)) && W(t);
	}), ah(n.requestedSourceIds, `${t}.requestedSourceIds`), n.sourceIds.some((e) => !n.requestedSourceIds.includes(e)) && W(`${t}.requestedSourceIds`)), sh(n.createdAt, `${t}.createdAt`), ch(n.asOf, `${t}.asOf`), lh(n.period, `${t}.period`, bh), lh(n.comparePeriod, `${t}.comparePeriod`, bh), lh(n.branch, `${t}.branch`, $m), (typeof n.currency != "string" || !/^[A-Z]{3}$/.test(n.currency)) && W(`${t}.currency`), ih(n.figures, `${t}.figures`, 120, (e, t) => {
		let r = Zm(e, t, [
			"key",
			"label",
			"minor",
			"display",
			"unit"
		], ["currency"]);
		$m(r.key, `${t}.key`), Qm(r.label, `${t}.label`), rh(r.minor, `${t}.minor`), Qm(r.display, `${t}.display`), eh(r.unit, `${t}.unit`, ["money", "basis-points"]), r.unit === "money" && r.currency !== n.currency && W(`${t}.currency`), Object.hasOwn(r, "currency") && (typeof r.currency != "string" || !/^[A-Z]{3}$/.test(r.currency)) && W(`${t}.currency`);
	}), ah(n.figures, `${t}.figures`, "key"), rh(n.valueMinor, `${t}.valueMinor`), rh(n.totalMinor, `${t}.totalMinor`), ih(n.rowIds, `${t}.rowIds`, 1e4, $m), ah(n.rowIds, `${t}.rowIds`), ih(n.rows, `${t}.rows`, 1e4, (e, t) => {
		let n = Zm(e, t, [
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
		]) $m(n[e], `${t}.${e}`);
		nh(n.sourceRow, `${t}.sourceRow`), n.sourceRow === 0 && W(`${t}.sourceRow`), rh(n.amountMinor, `${t}.amountMinor`), oh(n.validFrom, `${t}.validFrom`), Object.hasOwn(n, "dueDate") && oh(n.dueDate, `${t}.dueDate`);
		for (let e of [
			"measureField",
			"invoiceId",
			"customerId",
			"orderId",
			"status",
			"branch"
		]) Object.hasOwn(n, e) && Qm(n[e], `${t}.${e}`);
		if (Object.hasOwn(n, "normalization")) {
			let e = Zm(n.normalization, `${t}.normalization`, [
				"sourceCurrency",
				"targetCurrency",
				"rate"
			]);
			for (let n of ["sourceCurrency", "targetCurrency"]) (typeof e[n] != "string" || !/^[A-Z]{3}$/.test(e[n])) && W(`${t}.normalization.${n}`);
			xh(e.rate, `${t}.normalization.rate`);
		}
	}), ah(n.rows, `${t}.rows`, "factId"), Array.isArray(n.rows) && Array.isArray(n.rowIds) && (n.rowIds.length !== n.rows.length || n.rows.some((e, t) => e.factId !== n.rowIds[t])) && W(`${t}.rowIds`), ih(n.exclusions, `${t}.exclusions`, 1e4, (e, t) => {
		let n = Zm(e, t, ["rowId", "reason"]);
		$m(n.rowId, `${t}.rowId`), Qm(n.reason, `${t}.reason`);
	});
	let r = Zm(n.coverage, `${t}.coverage`, [
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
	]) nh(r[e], `${t}.coverage.${e}`);
	Array.isArray(n.rows) && r.countedRows !== n.rows.length && W(`${t}.coverage.countedRows`), ih(r.importIds, `${t}.coverage.importIds`, 1e4, $m), ih(r.gaps, `${t}.coverage.gaps`, 1e3, Qm), eh(r.completeness, `${t}.coverage.completeness`, [
		"reconciled-imports",
		"unreconciled-facts",
		"empty",
		"partial"
	]), Xm(n.assumptions, `${t}.assumptions`), xh(n.assumptions, `${t}.assumptions`), Qm(n.explanation, `${t}.explanation`, 1e5, !0), th(n.stale, `${t}.stale`), Object.hasOwn(n, "staleReason") && Qm(n.staleReason, `${t}.staleReason`), ih(n.allowedNumbers, `${t}.allowedNumbers`, 1e4, (e, t) => {
		(typeof e != "string" || e.length > 256 || !/^-?\d+(?:\.\d+)?$/.test(e)) && W(t);
	});
}
function wh(e, t) {
	t(e, "reply");
	let n = structuredClone(e);
	function r(e) {
		e && typeof e == "object" && (Object.freeze(e), Object.values(e).forEach(r));
	}
	return r(n), n;
}
var Th = (e) => wh(e, mh), Eh = (e) => wh(e, yh), Dh = (e) => wh(e, Ch);
function Oh(e) {
	let t = Zm(e, "receipt", [...Sh, "definitions"], [
		"staleReason",
		"requestedSourceIds",
		"compiledCalculation",
		"databaseProof"
	]);
	Array.isArray(t.definitions) || W("receipt.definitions");
	for (let e of [
		"definitions",
		"compiledCalculation",
		"databaseProof"
	]) Object.hasOwn(t, e) && xh(t[e], `receipt.${e}`);
	let n = {};
	for (let e of [
		...Sh,
		"staleReason",
		"requestedSourceIds"
	]) Object.hasOwn(t, e) && (n[e] = t[e]);
	return Dh(n);
}
//#endregion
//#region app/ui/src/bridge/calculation-parameters.ts
var kh = [
	"period",
	"comparePeriod",
	"assumptions"
], Ah = "Owner-requested price assumption in basis points; scenario only, not a measured fact.", jh = (e) => {
	throw new Ym(e);
};
function Mh(e, t) {
	(!e || typeof e != "object" || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype || Object.getOwnPropertySymbols(e).length) && jh(t);
	for (let n of Object.values(Object.getOwnPropertyDescriptors(e))) (!n.enumerable || !Object.hasOwn(n, "value")) && jh(t);
	return e;
}
function Nh(e, t, n, r = []) {
	let i = Mh(e, t);
	return (n.some((e) => !Object.hasOwn(i, e)) || Object.keys(i).some((e) => !n.includes(e) && !r.includes(e)) || Object.values(i).some((e) => e === void 0)) && jh(t), i;
}
function Ph(e, t) {
	let n = Nh(e, t, ["from", "to"]);
	return oh(n.from, t + ".from"), oh(n.to, t + ".to"), n.from > n.to && jh(t), {
		from: n.from,
		to: n.to
	};
}
function Fh(e, t) {
	if (typeof e != "string" || e.length > 2e4 || !/^-?[0-9]+$/.test(e)) return jh(t);
	let n = BigInt(e);
	return (n < -10000n || n > 100000n) && jh(t), e;
}
function Ih(e, t) {
	let n = Nh(e, t, [], kh), r = {};
	return Object.hasOwn(n, "period") && (r.period = Ph(n.period, t + ".period")), Object.hasOwn(n, "comparePeriod") && (r.comparePeriod = Ph(n.comparePeriod, t + ".comparePeriod")), Object.hasOwn(n, "assumptions") && (r.assumptions = { priceChangeBps: Fh(Nh(n.assumptions, t + ".assumptions", ["priceChangeBps"]).priceChangeBps, t + ".assumptions.priceChangeBps") }), r;
}
function Lh(e, t, n) {
	let r = Nh(e, n, [], kh);
	for (let e of kh) Object.hasOwn(r, e) !== Object.hasOwn(t, e) && jh(n + "." + e), Object.hasOwn(r, e) && r[e] !== "owner-requested" && r[e] !== "retained-owner-requested" && jh(n + "." + e);
	return r;
}
function Rh(e, t) {
	return {
		kind: "owner-requested-calculation-parameters",
		period: e.period ?? null,
		comparePeriod: e.comparePeriod ?? null,
		assumptions: e.assumptions ? {
			origin: "owner-requested",
			label: Ah,
			priceChangeBps: e.assumptions.priceChangeBps
		} : null,
		missingInputClarifications: {
			change: !e.period && !e.comparePeriod ? "Which current and comparison periods should I use?" : e.period ? e.comparePeriod ? null : "Which comparison period should I use?" : "Which current period should I use?",
			scenario: e.assumptions ? null : "What price change in basis points should I assume?"
		},
		origins: t
	};
}
function zh(e, t, n, r) {
	let i = Nh(e, r, [
		"kind",
		"period",
		"comparePeriod",
		"assumptions",
		"missingInputClarifications",
		"origins"
	]);
	if (i.kind !== "owner-requested-calculation-parameters" && jh(r + ".kind"), i.period !== null && Ph(i.period, r + ".period"), i.comparePeriod !== null && Ph(i.comparePeriod, r + ".comparePeriod"), i.assumptions !== null) {
		let e = Nh(i.assumptions, r + ".assumptions", [
			"origin",
			"label",
			"priceChangeBps"
		]);
		(e.origin !== "owner-requested" || e.label !== "Owner-requested price assumption in basis points; scenario only, not a measured fact.") && jh(r + ".assumptions"), Fh(e.priceChangeBps, r + ".assumptions.priceChangeBps");
	}
	let a = Nh(i.missingInputClarifications, r + ".missingInputClarifications", ["change", "scenario"]);
	for (let e of ["change", "scenario"]) a[e] !== null && typeof a[e] != "string" && jh(r + ".missingInputClarifications." + e);
	Lh(i.origins, t, r + ".origins");
	let o = Rh(t, n);
	JSON.stringify(i) !== JSON.stringify(o) && jh(r);
}
//#endregion
//#region app/ui/src/bridge/conversation-contract.ts
var Bh = /* @__PURE__ */ new WeakMap();
function G(e) {
	throw new Ym(e);
}
function Vh(e, t) {
	(!e || typeof e != "object" || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype || Object.getOwnPropertySymbols(e).length) && G(t);
	for (let n of Object.values(Object.getOwnPropertyDescriptors(e))) (!Object.hasOwn(n, "value") || !n.enumerable) && G(t);
	return e;
}
function K(e, t, n, r = []) {
	let i = Vh(e, t);
	return (n.some((e) => !Object.hasOwn(i, e)) || Object.keys(i).some((e) => !n.includes(e) && !r.includes(e)) || Object.values(i).some((e) => e === void 0)) && G(t), i;
}
function q(e, t, n = 2e4, r = !1) {
	(typeof e != "string" || e.length > n || !r && !e.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(e)) && G(t);
}
function Hh(e, t) {
	(typeof e != "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(e)) && G(t);
}
function Uh(e, t) {
	(typeof e != "string" || !/^[a-f0-9]{64}$/.test(e)) && G(t);
}
function J(e, t, n) {
	e !== t && G(n);
}
function Wh(e, t, n) {
	(typeof e != "string" || !t.includes(e)) && G(n);
}
function Gh(e, t, n = 0) {
	(typeof e != "number" || !Number.isSafeInteger(e) || e < n) && G(t);
}
function Kh(e, t, n) {
	(!Array.isArray(e) || Object.getPrototypeOf(e) !== Array.prototype || e.length > n || Object.getOwnPropertySymbols(e).length) && G(t);
	let r = Object.getOwnPropertyDescriptors(e);
	Object.keys(r).length !== e.length + 1 && G(t);
	for (let n = 0; n < e.length; n++) {
		let e = r[String(n)];
		(!e?.enumerable || !Object.hasOwn(e, "value")) && G(t);
	}
	return e;
}
function qh(e, t, n = 1e4) {
	let r = Kh(e, t, n);
	return r.forEach((e, n) => Hh(e, `${t}[${n}]`)), new Set(r).size !== r.length && G(t), r;
}
function Jh(e, t) {
	let n = Kh(e, t, 64);
	return (n.some((e) => typeof e != "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(e)) || new Set(n).size !== n.length) && G(t), n;
}
function Yh(e, t, n) {
	JSON.stringify([...e].sort()) !== JSON.stringify([...t].sort()) && G(n);
}
function Xh(e, t) {
	if (e === t) return !0;
	if (!e || !t || typeof e != "object" || typeof t != "object" || Array.isArray(e) !== Array.isArray(t)) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => Object.hasOwn(t, n) && Xh(Object.getOwnPropertyDescriptor(e, n)?.value, Object.getOwnPropertyDescriptor(t, n)?.value));
}
function Zh(e) {
	return e && typeof e == "object" && (Object.values(e).forEach(Zh), Object.freeze(e)), e;
}
function Qh(e) {
	try {
		return Zh(structuredClone(e));
	} catch {
		return G("reply.data");
	}
}
function $h(e, t, n = 4194304) {
	let r = 0;
	function i(e, t, n) {
		if ((++r > 2e5 || n > 20) && G(t), e === null || typeof e == "boolean") return;
		if (typeof e == "string") {
			q(e, t, 262144, !0);
			return;
		}
		if (typeof e == "number") {
			Number.isFinite(e) || G(t);
			return;
		}
		if (Array.isArray(e)) {
			Kh(e, t, 1e4).forEach((e, r) => i(e, `${t}[${r}]`, n + 1));
			return;
		}
		let a = Vh(e, t);
		Object.keys(a).length > 1e3 && G(t);
		for (let [e, r] of Object.entries(a)) [
			"__proto__",
			"prototype",
			"constructor"
		].includes(e) && G(t), i(r, `${t}.${e}`, n + 1);
	}
	i(e, t, 0), new TextEncoder().encode(JSON.stringify(e)).length > n && G(t);
}
function eg(e, t) {
	let n = K(e, t, [], [
		"sourceIds",
		"branch",
		"asOf",
		"onDate",
		"period"
	]);
	if (Object.hasOwn(n, "sourceIds") && Jh(n.sourceIds, `${t}.sourceIds`), Object.hasOwn(n, "branch") && q(n.branch, `${t}.branch`, 200), Object.hasOwn(n, "asOf") && (q(n.asOf, `${t}.asOf`, 64), Number.isFinite(Date.parse(n.asOf)) || G(`${t}.asOf`)), Object.hasOwn(n, "onDate") && oh(n.onDate, `${t}.onDate`), Object.hasOwn(n, "period")) {
		let e = K(n.period, `${t}.period`, ["from", "to"]);
		oh(e.from, `${t}.period.from`), oh(e.to, `${t}.period.to`), e.from > e.to && G(`${t}.period`);
	}
}
function tg(e) {
	return Hh(e, "request.id"), e;
}
function ng(e) {
	return Object.freeze({ id: tg(e) });
}
function rg(e) {
	let t = K(e, "request", [
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
	q(t.question, "request.question", 8e3), J(t.purpose, "conversation", "request.purpose"), J(t.questionDisclosure, "verbatim", "request.questionDisclosure"), Hh(t.routeId, "request.routeId"), Object.hasOwn(t, "continuationId") && Hh(t.continuationId, "request.continuationId");
	let n = {};
	for (let e of [
		"sourceIds",
		"branch",
		"asOf",
		"onDate",
		"period"
	]) Object.hasOwn(t, e) && (n[e] = t[e]);
	return eg(n, "request.scope"), Sg(t, "request.calculationParameters"), $h(e, "request", 131072), Qh(e);
}
function ig(e, t, n) {
	let r = K(e, n, [
		"schemaVersion",
		"turnId",
		"originalQuestion",
		"clarification",
		"sourceIds",
		"requestScope",
		"digest"
	], ["exchanges", "reviewedCalculationParameters"]);
	J(r.schemaVersion, 1, `${n}.schemaVersion`), Hh(r.turnId, `${n}.turnId`), J(r.turnId, t, `${n}.turnId`), q(r.originalQuestion, `${n}.originalQuestion`, 8e3), q(r.clarification, `${n}.clarification`, 500), Uh(r.digest, `${n}.digest`), Jh(r.sourceIds, `${n}.sourceIds`), eg(r.requestScope, `${n}.requestScope`);
	let i = r.requestScope;
	if (Object.hasOwn(r, "reviewedCalculationParameters")) {
		let e = Ih(r.reviewedCalculationParameters, n + ".reviewedCalculationParameters");
		Object.hasOwn(i, "period") && !Xh(e.period, i.period) && G(n + ".reviewedCalculationParameters.period");
	}
	Object.hasOwn(i, "sourceIds") && Yh(i.sourceIds, r.sourceIds, `${n}.requestScope.sourceIds`), Object.hasOwn(r, "exchanges") && Kh(r.exchanges, `${n}.exchanges`, 8).forEach((e, t) => {
		let r = K(e, `${n}.exchanges[${t}]`, ["question", "clarification"]);
		q(r.question, `${n}.exchanges[${t}].question`, 8e3), q(r.clarification, `${n}.exchanges[${t}].clarification`, 500);
	}), $h(e, n, 131072);
}
function ag(e, t) {
	return Hh(t, "request.id"), ig(e, t, "continuation"), Qh(e);
}
async function og(e, t) {
	try {
		let t = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(e));
		return [...new Uint8Array(t)].map((e) => e.toString(16).padStart(2, "0")).join("");
	} catch {
		return G(t);
	}
}
async function sg(e, t) {
	let n = ag(e, t), { digest: r, ...i } = n;
	return J(await og(JSON.stringify(i), "continuation.digest"), r, "continuation.digest"), n;
}
function cg(e, t, n) {
	q(e, t, 2e3);
	let r;
	try {
		r = new URL(e);
	} catch {
		return G(t);
	}
	if (r.protocol === "cli:") {
		(!["cli://codex/provider-managed", "cli://claude/provider-managed"].includes(e) || n !== "application-to-official-cli") && G(t);
		return;
	}
	n === "application-to-official-cli" && G(t), (r.username || r.password || r.search || r.hash || !(r.protocol === "https:" || r.protocol === "http:" && [
		"localhost",
		"127.0.0.1",
		"[::1]"
	].includes(r.hostname))) && G(t);
}
var lg = /* @__PURE__ */ "id.kind.status.purpose.createdAt.at.memberId.epoch.routeId.routeRevision.endpoint.questionDisclosure.naturalQuestion.questionHash.sourceIds.factIds.rowIds.factDigest.trustFingerprint.schema.schemaDigest.instructions.payload.digest.approvalRequired.send.receiptBoundary.providerPayloadObserved.costReservedMinor.costCurrency.experimental".split("."), ug = [
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
], dg = [
	"continuationId",
	"continuationDigest",
	"continuation",
	"continuationDisclosure",
	"continuationDisclosureWarning",
	"requestScopeDigest"
], fg = [
	"toolTurnId",
	"synthesisAuthority",
	"synthesisAuthorityDigest",
	"synthesisSummary",
	"synthesisBinding",
	"synthesisInputDigest",
	"synthesisDisclosure",
	"synthesisDisclosureWarning"
], pg = [
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
	...dg.filter((e) => e !== "requestScopeDigest"),
	"reviewedCalculationParameters",
	"calculationParameterOrigins",
	"calculationParametersDigest",
	"calculationParameterDisclosure",
	"calculationParameterDisclosureWarning",
	"toolTurnId",
	"synthesisInputDigest",
	"synthesisDisclosure",
	"synthesisDisclosureWarning"
], mg = [
	"industry",
	"products",
	"customers",
	"business_model",
	"location"
], hg = [
	"workspace-metadata",
	"published-definition",
	"source-observation",
	"owner-told",
	"draft-assumption"
], gg = {
	"workspace-metadata": ["metadata-only"],
	"published-definition": ["metadata-only"],
	"source-observation": ["unqualified-observation", "evidence-qualified"],
	"owner-told": ["owner-stated"],
	"draft-assumption": ["draft"]
};
function _g(e, t, n) {
	(typeof e != "string" || typeof t != "string" || !gg[e]?.includes(t)) && G(n);
}
function vg(e, t, n) {
	(typeof e != "string" || !RegExp(`^${t}[1-9]\\d{0,3}$`).test(e)) && G(n);
}
function yg(e, t, n) {
	let r = qh(e, n, 8192);
	return r.forEach((e) => vg(e, t, n)), r;
}
function bg(e, t) {
	let n = K(e, t, [
		"schemaVersion",
		"question",
		"results",
		"evidence",
		"citationRefs"
	]);
	J(n.schemaVersion, 1, `${t}.schemaVersion`), q(n.question, `${t}.question`, 8e3);
	let r = yg(n.citationRefs, "c", `${t}.citationRefs`), i = Kh(n.evidence, `${t}.evidence`, 64), a = Kh(n.results, `${t}.results`, 4);
	(!a.length || !i.length || r.length > 64) && G(`${t}.results`);
	let o = /* @__PURE__ */ new Map();
	i.forEach((e, n) => {
		let i = `${t}.evidence[${n}]`, a = Vh(e, i);
		if (vg(a.ref, "e", `${i}.ref`), vg(a.resultRef, "r", `${i}.resultRef`), o.has(a.ref) && G(`${i}.ref`), o.set(a.ref, a), a.kind === "claim") {
			K(a, i, [
				"kind",
				"ref",
				"resultRef",
				"text",
				"origin",
				"qualification",
				"citationRefs"
			]), q(a.text, `${i}.text`, 4096), Wh(a.origin, hg, `${i}.origin`), _g(a.origin, a.qualification, `${i}.qualification`);
			let e = yg(a.citationRefs, "c", `${i}.citationRefs`);
			(!e.length || e.length > 16 || e.some((e) => !r.includes(e))) && G(`${i}.citationRefs`);
		} else a.kind === "figure" ? (K(a, i, [
			"kind",
			"ref",
			"resultRef",
			"label",
			"unit"
		], ["currency"]), q(a.label, `${i}.label`, 200), Wh(a.unit, ["money", "basis-points"], `${i}.unit`), Object.hasOwn(a, "currency") && (typeof a.currency != "string" || !/^[A-Z]{3}$/.test(a.currency)) && G(`${i}.currency`), a.unit === "money" && !Object.hasOwn(a, "currency") && G(`${i}.currency`), a.unit === "basis-points" && Object.hasOwn(a, "currency") && G(`${i}.currency`)) : a.kind === "scope" ? (K(a, i, [
			"kind",
			"ref",
			"resultRef",
			"label"
		]), q(a.label, `${i}.label`, 200)) : a.kind === "caution" ? (K(a, i, [
			"kind",
			"ref",
			"resultRef",
			"code",
			"label",
			"required"
		]), (typeof a.code != "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(a.code)) && G(`${i}.code`), q(a.label, `${i}.label`, 512), J(a.required, !0, `${i}.required`)) : G(`${i}.kind`);
	});
	let s = /* @__PURE__ */ new Set();
	a.forEach((e, n) => {
		let r = `${t}.results[${n}]`, i = K(e, r, [
			"ref",
			"tool",
			"status",
			"evidenceRefs"
		]);
		vg(i.ref, "r", `${r}.ref`), s.has(i.ref) && G(`${r}.ref`), s.add(i.ref), Wh(i.tool, ["business.describe", "calculator.calculate"], `${r}.tool`), Wh(i.status, [
			"ok",
			"partial",
			"unavailable"
		], `${r}.status`);
		let a = yg(i.evidenceRefs, "e", `${r}.evidenceRefs`), c = [...o.values()].filter((e) => e.resultRef === i.ref);
		(!a.length || a.length > 64 || !Xh(a, c.map((e) => e.ref))) && G(`${r}.evidenceRefs`), i.status !== "ok" && !c.some((e) => e.kind === "caution") && G(`${r}.status`);
	}), [...o.values()].some((e) => !s.has(e.resultRef)) && G(`${t}.evidence`), $h(e, t, 131072);
}
function xg(e, t) {
	bg(e.synthesisSummary, `${t}.synthesisSummary`);
	let n = e.synthesisSummary, r = K(e.synthesisBinding, `${t}.synthesisBinding`, [
		"toolTurnId",
		"plannerModelReceiptId",
		"toolResultsDigest",
		"inputDigest",
		"evidence"
	]);
	Hh(r.toolTurnId, `${t}.synthesisBinding.toolTurnId`), Hh(r.plannerModelReceiptId, `${t}.synthesisBinding.plannerModelReceiptId`), Uh(r.toolResultsDigest, `${t}.synthesisBinding.toolResultsDigest`), Uh(r.inputDigest, `${t}.synthesisBinding.inputDigest`), J(r.toolTurnId, e.toolTurnId, `${t}.synthesisBinding.toolTurnId`), J(r.inputDigest, e.synthesisInputDigest, `${t}.synthesisBinding.inputDigest`), J(n.question, e.naturalQuestion, `${t}.synthesisSummary.question`);
	let i = Kh(r.evidence, `${t}.synthesisBinding.evidence`, 8192), a = /* @__PURE__ */ new Set(), o = n.evidence;
	i.forEach((e, n) => {
		let r = `${t}.synthesisBinding.evidence[${n}]`, i = K(e, r, [
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
		vg(i.ref, "e", `${r}.ref`), vg(i.resultRef, "r", `${r}.resultRef`), Hh(i.answerId, `${r}.answerId`), Uh(i.evidenceHash, `${r}.evidenceHash`), q(i.renderText, `${r}.renderText`), (a.has(i.ref) || !o.some((e) => e.ref === i.ref && e.resultRef === i.resultRef)) && G(`${r}.ref`), a.add(i.ref);
		for (let e of ["receiptId", "figureKey"]) Object.hasOwn(i, e) && Hh(i[e], `${r}.${e}`);
		Object.hasOwn(i, "citationIds") && qh(i.citationIds, `${r}.citationIds`);
	}), a.size !== o.length && G(`${t}.synthesisBinding.evidence`);
	let s = K(e.synthesisAuthority, `${t}.synthesisAuthority`, [
		"summary",
		"binding",
		"sourceIds",
		"factIds",
		"rowIds"
	]);
	(JSON.stringify(s.summary) !== JSON.stringify(n) || JSON.stringify(s.binding) !== JSON.stringify(r)) && G(`${t}.synthesisAuthority`);
	for (let n of [
		"sourceIds",
		"factIds",
		"rowIds"
	]) Yh(qh(s[n], `${t}.synthesisAuthority.${n}`), e[n], `${t}.synthesisAuthority.${n}`);
}
function Sg(e, t) {
	let n = {};
	for (let t of kh) Object.hasOwn(e, t) && (n[t] = e[t]);
	return Ih(n, t);
}
function Cg(e, t) {
	let n = "preview", r = Ih(e.reviewedCalculationParameters, n + ".reviewedCalculationParameters"), i = Lh(e.calculationParameterOrigins, r, n + ".calculationParameterOrigins"), a = Sg(t, "request.calculationParameters"), o = e.continuation, s = o?.requestScope, c = Ih(o?.reviewedCalculationParameters ?? (s?.period === void 0 ? {} : { period: s.period }), n + ".continuation.reviewedCalculationParameters"), l = {}, u = {};
	for (let e of kh) {
		c[e] !== void 0 && a[e] !== void 0 && !Xh(c[e], a[e]) && G(n + ".reviewedCalculationParameters." + e);
		let t = c[e] ?? a[e];
		t !== void 0 && (l[e] = t, u[e] = c[e] === void 0 ? "owner-requested" : "retained-owner-requested");
	}
	(!Xh(r, l) || !Xh(i, u)) && G(n + ".reviewedCalculationParameters");
	let d = e.requestScope;
	Object.hasOwn(d, "period") && !Xh(r.period, d.period) && G(n + ".requestScope.period"), zh(e.calculationParameterDisclosure, r, i, n + ".calculationParameterDisclosure"), Uh(e.calculationParametersDigest, n + ".calculationParametersDigest"), q(e.calculationParameterDisclosureWarning, n + ".calculationParameterDisclosureWarning");
}
function wg(e, t) {
	let n = "preview", r = Vh(e, n).purpose === "conversation-synthesis", i = K(e, n, [...lg, ...r ? fg : ug], ["estimatedCostMinor", ...r ? [] : dg]);
	J(i.kind, "model-preview", `${n}.kind`), J(i.status, "preview", `${n}.status`), Wh(i.purpose, ["conversation", "conversation-synthesis"], `${n}.purpose`);
	for (let e of [
		"id",
		"memberId",
		"routeId"
	]) Hh(i[e], `${n}.${e}`);
	for (let e of ["epoch", "routeRevision"]) Gh(i[e], `${n}.${e}`, 1);
	for (let e of ["createdAt", "at"]) sh(i[e], `${n}.${e}`);
	for (let e of [
		"questionHash",
		"factDigest",
		"trustFingerprint",
		"schemaDigest",
		"digest"
	]) Uh(i[e], `${n}.${e}`);
	J(i.questionDisclosure, "verbatim", `${n}.questionDisclosure`), q(i.naturalQuestion, `${n}.naturalQuestion`, 8e3), q(i.instructions, `${n}.instructions`, 262144), q(i.payload, `${n}.payload`, 262144), new TextEncoder().encode(i.payload).length > 262144 && G(`${n}.payload`), J(i.approvalRequired, !0, `${n}.approvalRequired`), J(i.costReservedMinor, "0", `${n}.costReservedMinor`), J(i.costCurrency, "INR", `${n}.costCurrency`), J(i.experimental, !0, `${n}.experimental`), Wh(i.send, ["shape", "samples"], `${n}.send`), Wh(i.receiptBoundary, ["application-to-official-cli", "application-to-provider-http"], `${n}.receiptBoundary`), J(i.providerPayloadObserved, i.receiptBoundary === "application-to-provider-http", `${n}.providerPayloadObserved`);
	for (let e of [
		"sourceIds",
		"factIds",
		"rowIds"
	]) qh(i[e], `${n}.${e}`);
	if (Object.hasOwn(i, "endpoint") && cg(i.endpoint, `${n}.endpoint`, i.receiptBoundary), Object.hasOwn(i, "estimatedCostMinor") && (typeof i.estimatedCostMinor != "string" || !/^\d{1,256}$/.test(i.estimatedCostMinor)) && G(`${n}.estimatedCostMinor`), r) {
		let e = Ag(t.id, t.routeId);
		Hh(i.toolTurnId, `${n}.toolTurnId`), J(i.toolTurnId, e.id, `${n}.toolTurnId`), e.routeId !== void 0 && J(i.routeId, e.routeId, `${n}.routeId`), J(i.send, "samples", `${n}.send`), J(i.synthesisDisclosure, "admitted-tool-summary", `${n}.synthesisDisclosure`), q(i.synthesisDisclosureWarning, `${n}.synthesisDisclosureWarning`), Uh(i.synthesisInputDigest, `${n}.synthesisInputDigest`), Uh(i.synthesisAuthorityDigest, `${n}.synthesisAuthorityDigest`), xg(i, n);
	} else {
		let e = rg(t);
		J(i.naturalQuestion, e.question, `${n}.naturalQuestion`), J(i.routeId, e.routeId, `${n}.routeId`), q(i.questionDisclosureWarning, `${n}.questionDisclosureWarning`), q(i.definitionDisclosureWarning, `${n}.definitionDisclosureWarning`), J(i.definitionDisclosure, "published", `${n}.definitionDisclosure`);
		for (let e of ["contextDigest", "profileSamplesHash"]) Uh(i[e], `${n}.${e}`);
		qh(i.profileIds, `${n}.profileIds`), eg(i.requestScope, `${n}.requestScope`);
		let r = i.requestScope;
		for (let t of [
			"sourceIds",
			"branch",
			"asOf",
			"onDate",
			"period"
		]) e[t] !== void 0 && (t === "sourceIds" ? Yh(r[t] ?? [], e[t], `${n}.requestScope.${t}`) : t === "asOf" ? (typeof r[t] != "string" || Date.parse(r[t]) !== Date.parse(e[t])) && G(`${n}.requestScope.${t}`) : JSON.stringify(r[t]) !== JSON.stringify(e[t]) && G(`${n}.requestScope.${t}`));
		let a = dg.some((e) => Object.hasOwn(i, e));
		a !== (e.continuationId !== void 0) && G(`${n}.continuationId`), a && (dg.some((e) => !Object.hasOwn(i, e)) && G(`${n}.continuation`), J(i.continuationId, e.continuationId, `${n}.continuationId`), ig(i.continuation, e.continuationId, `${n}.continuation`), J(i.continuationDigest, i.continuation.digest, `${n}.continuationDigest`), J(i.continuationDisclosure, "verbatim", `${n}.continuationDisclosure`), Uh(i.requestScopeDigest, `${n}.requestScopeDigest`), q(i.continuationDisclosureWarning, `${n}.continuationDisclosureWarning`)), Cg(i, e);
	}
	$h(e, n);
	let a = {};
	for (let e of pg) Object.hasOwn(i, e) && (a[e] = i[e]);
	let o = Qh(a);
	return Bh.set(o, r ? {
		verified: !1,
		summary: Qh(i.synthesisSummary),
		binding: Qh(i.synthesisBinding)
	} : {
		verified: !1,
		request: rg(t)
	}), o;
}
async function Tg(e, t) {
	let n = wg(e, t), r = Qh(e);
	J(await og(n.payload, "preview.digest"), n.digest, "preview.digest"), J(await og(n.naturalQuestion, "preview.questionHash"), r.questionHash, "preview.questionHash"), J(await og(JSON.stringify(r.schema), "preview.schemaDigest"), r.schemaDigest, "preview.schemaDigest");
	let i;
	try {
		if (n.receiptBoundary === "application-to-official-cli") {
			let e = `${r.instructions}\n`;
			n.payload.startsWith(e) || G("preview.payload.instructions"), i = n.payload.slice(e.length);
		} else {
			let e = Vh(JSON.parse(n.payload), "preview.payload");
			if (Object.hasOwn(e, "messages")) {
				Object.hasOwn(e, "input") && G("preview.payload");
				let t = Kh(e.messages, "preview.payload.messages", 2);
				t.length !== 2 && G("preview.payload.messages");
				let n = K(t[0], "preview.payload.messages[0]", ["role", "content"]), a = K(t[1], "preview.payload.messages[1]", ["role", "content"]);
				J(n.role, "system", "preview.payload.messages[0].role"), J(n.content, r.instructions, "preview.payload.instructions"), J(a.role, "user", "preview.payload.messages[1].role"), i = a.content;
			} else J(e.instructions, r.instructions, "preview.payload.instructions"), i = e.input;
		}
		q(i, "preview.payload.input", 262144), i = JSON.parse(i);
	} catch {
		G("preview.payload.input");
	}
	$h(i, "preview.payload.input", 262144);
	let a = Vh(i, "preview.payload.input");
	if (n.purpose === "conversation-synthesis") {
		J(await og(JSON.stringify(r.synthesisSummary), "preview.synthesisInputDigest"), n.synthesisInputDigest, "preview.synthesisInputDigest"), J(await og(JSON.stringify(r.synthesisAuthority), "preview.synthesisAuthorityDigest"), r.synthesisAuthorityDigest, "preview.synthesisAuthorityDigest"), J(await og(JSON.stringify(a), "preview.payload.input"), n.synthesisInputDigest, "preview.payload.input");
		let e = r.synthesisSummary.evidence;
		for (let t of r.synthesisBinding.evidence) {
			let { ref: n, resultRef: r, ...i } = e.find((e) => e.ref === t.ref), a = Object.fromEntries(Object.entries(t).filter(([e]) => [
				"receiptId",
				"figureKey",
				"citationIds"
			].includes(e)));
			J(await og(JSON.stringify({
				item: i,
				renderText: t.renderText,
				metadata: a
			}), "preview.synthesisBinding.evidenceHash"), t.evidenceHash, "preview.synthesisBinding.evidenceHash");
		}
	} else {
		let e = Ih(r.reviewedCalculationParameters, "preview.reviewedCalculationParameters"), t = Lh(r.calculationParameterOrigins, e, "preview.calculationParameterOrigins");
		if (J(await og(JSON.stringify(r.reviewedCalculationParameters), "preview.calculationParametersDigest"), r.calculationParametersDigest, "preview.calculationParametersDigest"), zh(a.calculationParameters, e, t, "preview.payload.calculationParameters"), J(await og(JSON.stringify(a.calculationParameters), "preview.payload.calculationParameters"), await og(JSON.stringify(r.calculationParameterDisclosure), "preview.calculationParameterDisclosure"), "preview.payload.calculationParameters"), J(a.question, n.naturalQuestion, "preview.payload.question"), J(a.questionDisclosure, "verbatim", "preview.payload.questionDisclosure"), n.continuation) {
			let { turnId: e, originalQuestion: t, clarification: i, exchanges: o } = await sg(n.continuation, n.continuation.turnId);
			J(a.continuationDisclosure, "verbatim", "preview.payload.continuationDisclosure"), J(await og(JSON.stringify(a.continuation), "preview.payload.continuation"), await og(JSON.stringify({
				turnId: e,
				originalQuestion: t,
				clarification: i,
				...o === void 0 ? {} : { exchanges: o }
			}), "preview.continuation"), "preview.payload.continuation"), J(await og(JSON.stringify(r.requestScope), "preview.requestScopeDigest"), r.requestScopeDigest, "preview.requestScopeDigest");
			let s = Vh(r.businessContext, "preview.businessContext");
			eg(s.request, "preview.businessContext.request"), J(await og(JSON.stringify(r.requestScope), "preview.requestScopeDigest"), await og(JSON.stringify(s.request), "preview.businessContext.request"), "preview.requestScopeDigest");
		} else (Object.hasOwn(a, "continuation") || Object.hasOwn(a, "continuationDisclosure")) && G("preview.payload.continuation");
	}
	return Bh.get(n).verified = !0, n;
}
function Eg(e, t) {
	let n = K(e, "approval", [
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
	]) Hh(n[e], `approval.${e}`);
	return Uh(n.digest, "approval.digest"), J(n.kind, "outbound-approval", "approval.kind"), J(n.used, !1, "approval.used"), Gh(n.approverEpoch, "approval.approverEpoch", 1), sh(n.createdAt, "approval.createdAt"), sh(n.expiresAt, "approval.expiresAt"), Date.parse(n.expiresAt) <= Date.parse(n.createdAt) && G("approval.expiresAt"), Object.hasOwn(n, "endpoint") && cg(n.endpoint, "approval.endpoint", t.receiptBoundary), J(n.previewId, t.id, "approval.previewId"), J(n.digest, t.digest, "approval.digest"), J(n.routeId, t.routeId, "approval.routeId"), J(n.endpoint, t.endpoint, "approval.endpoint"), Qh(e);
}
function Dg(e) {
	let t = Bh.get(e);
	return t?.verified || G("preview.verification"), t;
}
function Og(e) {
	return Dg(e), ng(e.id);
}
function kg(e, t, n) {
	let r = rg(e);
	return J(t.purpose, "conversation", "request.preview.purpose"), J(t.naturalQuestion, r.question, "request.preview.question"), J(t.routeId, r.routeId, "request.preview.routeId"), Xh(Dg(t).request, r) || G("request.preview.scope"), J(t.continuationId, r.continuationId, "request.preview.continuationId"), Eg(n, t), Qh({
		...r,
		previewId: t.id,
		approvalId: n.id
	});
}
function Ag(e, t) {
	let n = { id: tg(e) };
	return t !== void 0 && (Hh(t, "request.routeId"), n.routeId = t), Object.freeze(n);
}
function jg(e, t, n) {
	Dg(t);
	let r = tg(e);
	return J(t.purpose, "conversation-synthesis", "request.preview.purpose"), J(t.toolTurnId, r, "request.preview.toolTurnId"), Eg(n, t), Object.freeze({
		id: r,
		previewId: t.id,
		approvalId: n.id
	});
}
function Mg(e, t, n) {
	let r = K(e, t, [
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
	Hh(r.id, `${t}.id`), J(r.kind, "business-context", `${t}.kind`), Wh(r.status, [
		"grounded",
		"partial",
		"unknown"
	], `${t}.status`), q(r.message, `${t}.message`, 2e4, !0), Uh(r.contextDigest, `${t}.contextDigest`);
	for (let e of [
		"sourceIds",
		"rowIds",
		"profileIds"
	]) qh(r[e], `${t}.${e}`, 256);
	let i = Kh(r.citations, `${t}.citations`, 256), a = /* @__PURE__ */ new Set();
	i.forEach((e, n) => {
		let r = `${t}.citations[${n}]`, i = K(e, r, [
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
		for (let e of ["id", "referenceId"]) Hh(i[e], `${r}.${e}`);
		q(i.path, `${r}.path`), Uh(i.contentHash, `${r}.contentHash`), Wh(i.kind, [
			"workspace",
			"dictionary",
			"fact",
			"profile"
		], `${r}.kind`), a.has(i.id) && G(`${r}.id`), a.add(i.id);
		for (let e of [
			"sourceId",
			"factId",
			"branch"
		]) Object.hasOwn(i, e) && q(i[e], `${r}.${e}`, 200);
		Object.hasOwn(i, "sourceRow") && Gh(i.sourceRow, `${r}.sourceRow`, 1), Object.hasOwn(i, "validFrom") && oh(i.validFrom, `${r}.validFrom`), Object.hasOwn(i, "validTo") && i.validTo !== null && oh(i.validTo, `${r}.validTo`), Object.hasOwn(i, "learnedAt") && sh(i.learnedAt, `${r}.learnedAt`);
	});
	let o = /* @__PURE__ */ new Set(), s = /* @__PURE__ */ new Set(), c = Kh(r.claims, `${t}.claims`, 16);
	c.forEach((e, n) => {
		let r = `${t}.claims[${n}]`, i = K(e, r, [
			"id",
			"category",
			"text",
			"origin",
			"qualification",
			"citationIds"
		]);
		Hh(i.id, `${r}.id`), q(i.text, `${r}.text`), Wh(i.category, [
			"workspace",
			"definitions",
			"records",
			...mg
		], `${r}.category`), Wh(i.origin, hg, `${r}.origin`), _g(i.origin, i.qualification, `${r}.qualification`), o.has(i.id) && G(`${r}.id`), o.add(i.id);
		let c = qh(i.citationIds, `${r}.citationIds`, 256);
		(!c.length || c.some((e) => !a.has(e))) && G(`${r}.citationIds`), c.forEach((e) => s.add(e));
	}), s.size !== a.size && G(`${t}.citations`);
	let l = /* @__PURE__ */ new Set(), u = Kh(r.unknowns, `${t}.unknowns`, 5);
	u.forEach((e, n) => {
		let r = `${t}.unknowns[${n}]`, i = K(e, r, ["category", "message"]);
		Wh(i.category, mg, `${r}.category`), q(i.message, `${r}.message`), l.has(i.category) && G(`${r}.category`), l.add(i.category), J(i.message, `I do not have an established ${i.category.replaceAll("_", " ")} description in the currently permitted evidence.`, `${r}.message`);
	});
	let d = Kh(r.conflicts, `${t}.conflicts`, 256);
	d.forEach((e, n) => {
		let r = `${t}.conflicts[${n}]`, i = K(e, r, [
			"category",
			"citationIds",
			"reason"
		]);
		Wh(i.category, ["records", ...mg], `${r}.category`), qh(i.citationIds, `${r}.citationIds`, 256).length || G(`${r}.citationIds`), q(i.reason, `${r}.reason`);
	});
	let f = K(r.scope, `${t}.scope`, [
		"branch",
		"asOf",
		"onDate",
		"syntheticFixture",
		"corpus",
		"completeness",
		"limitations"
	]);
	f.branch !== null && q(f.branch, `${t}.scope.branch`, 200), sh(f.asOf, `${t}.scope.asOf`), oh(f.onDate, `${t}.scope.onDate`), typeof f.syntheticFixture != "boolean" && G(`${t}.scope.syntheticFixture`), J(f.corpus, "currently-authorized-local-evidence", `${t}.scope.corpus`), J(f.completeness, "bounded", `${t}.scope.completeness`);
	let p = Kh(f.limitations, `${t}.scope.limitations`, 4);
	(p.length !== 3 && p.length !== 4 || [
		"Only currently permitted, retained local evidence was searched.",
		"Absence in this context does not establish absence elsewhere.",
		"Owner statements and draft assumptions are not verified financial results."
	].some((e, t) => p[t] !== e) || p.length === 4 && p[3] !== "Imported-record context is bounded; no exhaustive source coverage is claimed.") && G(`${t}.scope.limitations`);
	let m = c.some((e) => e.origin === "owner-told"), h = c.some((e) => ["draft", "unqualified-observation"].includes(e.qualification));
	J(r.status, m ? u.length || d.length || h ? "partial" : "grounded" : "unknown", `${t}.status`);
	let g = [
		...c.map((e) => e.text),
		...u.map((e) => e.message),
		...d.length ? ["Some permitted source claims conflict, so they were not treated as established business facts."] : []
	].join("\n");
	J(r.message, g, `${t}.message`);
	let _ = K(r.receipt, `${t}.receipt`, [
		"id",
		"kind",
		"contextDigest",
		"financialCalculation",
		"sourceIds",
		"rowIds"
	], ["modelReceiptId"]);
	J(_.id, r.id, `${t}.receipt.id`), J(_.kind, "business-context-receipt", `${t}.receipt.kind`), J(_.contextDigest, r.contextDigest, `${t}.receipt.contextDigest`), J(_.financialCalculation, !1, `${t}.receipt.financialCalculation`);
	for (let e of ["sourceIds", "rowIds"]) Yh(qh(_[e], `${t}.receipt.${e}`, 256), r[e], `${t}.receipt.${e}`);
	return Object.hasOwn(_, "modelReceiptId") && Hh(_.modelReceiptId, `${t}.receipt.modelReceiptId`), n !== void 0 && J(_.modelReceiptId, n, `${t}.receipt.modelReceiptId`), $h(e, t, 131072), Qh(e);
}
function Ng(e, t, n = 512) {
	let r = K(e, t, [
		"id",
		"kind",
		"modelReceiptId",
		"results",
		"receipt"
	]);
	Hh(r.id, `${t}.id`), Hh(r.modelReceiptId, `${t}.modelReceiptId`), J(r.kind, "grounded-conversation", `${t}.kind`);
	let i = Kh(r.results, `${t}.results`, 4);
	i.length || G(`${t}.results`);
	let a = i.map((e, i) => {
		let a = `${t}.results[${i}]`, o = Vh(e, a);
		if (Wh(o.tool, ["business.describe", "calculator.calculate"], `${a}.tool`), Object.hasOwn(o, "error")) {
			K(o, a, ["tool", "error"]);
			let e = K(o.error, `${a}.error`, ["code", "message"]);
			return (typeof e.code != "string" || !/^[A-Z][A-Z0-9_]{0,99}$/.test(e.code)) && G(`${a}.error.code`), q(e.message, `${a}.error.message`, n), Qh(o);
		}
		if (K(o, a, ["tool", "answer"]), o.tool === "business.describe") return {
			tool: "business.describe",
			answer: Mg(o.answer, `${a}.answer`, r.modelReceiptId)
		};
		let s = Oh(o.answer);
		return s.stale && G(`${a}.answer.stale`), {
			tool: "calculator.calculate",
			answer: s
		};
	}), o = K(r.receipt, `${t}.receipt`, [
		"id",
		"kind",
		"modelReceiptId",
		"resultRefs"
	]);
	J(o.id, r.id, `${t}.receipt.id`), J(o.kind, "conversation-tool-receipt", `${t}.receipt.kind`), J(o.modelReceiptId, r.modelReceiptId, `${t}.receipt.modelReceiptId`);
	let s = Kh(o.resultRefs, `${t}.receipt.resultRefs`, 4), c = a.filter((e) => !e.error), l = /* @__PURE__ */ new Set();
	return s.length !== c.length && G(`${t}.receipt.resultRefs`), s.forEach((e, n) => {
		let r = `${t}.receipt.resultRefs[${n}]`, i = K(e, r, ["tool", "answerId"]);
		J(i.tool, c[n]?.tool, `${r}.tool`), Hh(i.answerId, `${r}.answerId`), l.has(i.answerId) && G(`${r}.answerId`), l.add(i.answerId);
		let a = c[n];
		a?.tool === "business.describe" && J(i.answerId, a.answer?.id, `${r}.answerId`);
	}), Qh({
		...r,
		results: a
	});
}
function Pg(e, t, n = 512) {
	let r = K(e, t, [
		"id",
		"kind",
		"paragraphs",
		"cautions",
		"references",
		"tools",
		"receipt"
	]);
	Hh(r.id, `${t}.id`), J(r.kind, "synthesized-conversation", `${t}.kind`);
	let i = Kh(r.paragraphs, `${t}.paragraphs`, 12);
	i.length || G(`${t}.paragraphs`), i.forEach((e, n) => q(e, `${t}.paragraphs[${n}]`));
	let a = Ng(r.tools, `${t}.tools`, n), o = K(r.receipt, `${t}.receipt`, [
		"id",
		"kind",
		"toolTurnId",
		"plannerModelReceiptId",
		"synthesisModelReceiptId",
		"inputDigest",
		"outputDigest"
	]);
	J(o.id, r.id, `${t}.receipt.id`), J(o.kind, "conversation-synthesis-receipt", `${t}.receipt.kind`), J(o.toolTurnId, a.id, `${t}.receipt.toolTurnId`), J(o.plannerModelReceiptId, a.modelReceiptId, `${t}.receipt.plannerModelReceiptId`), Hh(o.synthesisModelReceiptId, `${t}.receipt.synthesisModelReceiptId`), Uh(o.inputDigest, `${t}.receipt.inputDigest`), Uh(o.outputDigest, `${t}.receipt.outputDigest`);
	let s = /* @__PURE__ */ new Set([a.id, ...a.receipt.resultRefs.map((e) => e.answerId)]), c = /* @__PURE__ */ new Set(), l = /* @__PURE__ */ new Set();
	a.results.forEach((e) => {
		e.error || (e.tool === "calculator.calculate" ? c.add(e.answer.id) : e.answer.citations.forEach((e) => l.add(e.id)));
	});
	let u = Kh(r.references, `${t}.references`, 12);
	u.length !== i.length && G(`${t}.references`), u.forEach((e, n) => {
		let r = `${t}.references[${n}]`, i = K(e, r, [
			"evidenceRefs",
			"answerIds",
			"receiptIds",
			"citationIds"
		]), a = yg(i.evidenceRefs, "e", `${r}.evidenceRefs`), o = qh(i.answerIds, `${r}.answerIds`, 5);
		(!a.length || !o.length || o.some((e) => !s.has(e))) && G(r), (qh(i.receiptIds, `${r}.receiptIds`, 4).some((e) => !c.has(e)) || qh(i.citationIds, `${r}.citationIds`, 256).some((e) => !l.has(e))) && G(r);
	});
	let d = /* @__PURE__ */ new Set();
	return Kh(r.cautions, `${t}.cautions`, 8192).forEach((e, n) => {
		let r = `${t}.cautions[${n}]`, i = K(e, r, ["ref", "text"]);
		vg(i.ref, "e", `${r}.ref`), q(i.text, `${r}.text`), d.has(i.ref) && G(`${r}.ref`), d.add(i.ref);
	}), Qh({
		...r,
		tools: a
	});
}
function Fg(e, t) {
	let n = K(e, t, ["clarification", "modelReceiptId"]);
	return q(n.clarification, `${t}.clarification`, 500), Hh(n.modelReceiptId, `${t}.modelReceiptId`), Qh(e);
}
function Ig(e, t = {}) {
	return Lg(e, t, 512);
}
function Lg(e, t, n) {
	$h(e, "answer");
	let r = Vh(e, "answer"), i;
	i = r.kind === "grounded-conversation" ? Ng(e, "answer", n) : r.kind === "synthesized-conversation" ? Pg(e, "answer", n) : Fg(e, "answer");
	let a = "modelReceiptId" in i ? i.modelReceiptId : i.receipt.plannerModelReceiptId;
	if (t.modelReceiptId !== void 0 && J(a, t.modelReceiptId, "answer.modelReceiptId"), (t.toolTurnId !== void 0 || t.synthesisModelReceiptId !== void 0 || t.inputDigest !== void 0) && ((!("kind" in i) || i.kind !== "synthesized-conversation") && G("answer.kind"), t.toolTurnId !== void 0 && J(i.receipt.toolTurnId, t.toolTurnId, "answer.receipt.toolTurnId"), t.synthesisModelReceiptId !== void 0 && J(i.receipt.synthesisModelReceiptId, t.synthesisModelReceiptId, "answer.receipt.synthesisModelReceiptId"), t.inputDigest !== void 0 && J(i.receipt.inputDigest, t.inputDigest, "answer.receipt.inputDigest")), t.preview !== void 0) {
		let e = t.preview, n = Dg(e);
		if (e.purpose === "conversation") J(a, e.id, "answer.modelReceiptId");
		else {
			(!("kind" in i) || i.kind !== "synthesized-conversation" || !n.summary || !n.binding) && G("answer.kind"), J(i.receipt.synthesisModelReceiptId, e.id, "answer.receipt.synthesisModelReceiptId"), J(i.receipt.toolTurnId, e.toolTurnId, "answer.receipt.toolTurnId"), J(i.receipt.inputDigest, e.synthesisInputDigest, "answer.receipt.inputDigest"), J(i.receipt.plannerModelReceiptId, n.binding.plannerModelReceiptId, "answer.receipt.plannerModelReceiptId");
			let t = n.summary.evidence, r = n.binding.evidence, a = t.filter((e) => e.kind === "caution").map((e) => ({
				ref: e.ref,
				text: r.find((t) => t.ref === e.ref)?.renderText
			}));
			Xh(i.cautions, a) || G("answer.cautions");
			let o = new Set(i.references.flatMap((e) => e.evidenceRefs));
			t.filter((e) => e.kind === "figure" || e.kind === "scope").some((e) => !o.has(e.ref)) && G("answer.references.coverage"), i.references.forEach((e, t) => {
				let n = e.evidenceRefs.map((e) => {
					let n = r.find((t) => t.ref === e);
					return n || G(`answer.references[${t}].evidenceRefs`), n;
				});
				for (let [r, i] of [
					["answerIds", n.map((e) => e.answerId)],
					["receiptIds", n.flatMap((e) => e.receiptId ? [e.receiptId] : [])],
					["citationIds", n.flatMap((e) => e.citationIds ?? [])]
				]) Yh(e[r], [...new Set(i)], `answer.references[${t}].${r}`);
			});
		}
	}
	return i;
}
async function Rg(e, t = {}) {
	let n = Ig(e, t);
	if (t.preview?.purpose === "conversation-synthesis") {
		let n = Qh(e), r = Dg(t.preview);
		J(await og(JSON.stringify(n.tools), "answer.tools.digest"), r.binding?.toolResultsDigest, "answer.tools.digest");
	}
	return n;
}
function zg(e, t) {
	Hh(t, "request.id"), $h(e, "readback");
	let n = K(e, "readback", [
		"id",
		"at",
		"question",
		"kind",
		"answer"
	]);
	Hh(n.id, "readback.id"), sh(n.at, "readback.at"), q(n.question, "readback.question", 8e3);
	let r;
	if (n.kind === "business-context") r = Mg(n.answer, "readback.answer");
	else if (n.kind === "calculation") {
		let e = Vh(n.answer, "readback.answer");
		if (Object.hasOwn(e, "supported")) {
			K(e, "readback.answer", [
				"supported",
				"message",
				"receipt"
			]), J(e.supported, !0, "readback.answer.supported"), q(e.message, "readback.answer.message");
			let t = Oh(e.receipt);
			t.stale && G("readback.answer.receipt.stale"), J(e.message, t.explanation, "readback.answer.message"), r = {
				supported: !0,
				message: e.message,
				receipt: t
			};
		} else r = Oh(e), r.stale && G("readback.answer.stale");
	} else Wh(n.kind, [
		"clarification",
		"grounded-conversation",
		"synthesized-conversation"
	], "readback.kind"), r = Lg(n.answer, {}, 2e3), J(n.kind, "kind" in r ? r.kind : "clarification", "readback.kind");
	return n.id !== t && !(n.kind === "clarification" && "modelReceiptId" in r && r.modelReceiptId === t) && G("readback.id"), [
		"business-context",
		"grounded-conversation",
		"synthesized-conversation"
	].includes(n.kind) && J(r.id, n.id, "readback.answer.id"), Qh({
		...n,
		answer: r
	});
}
//#endregion
//#region app/ui/src/app/conversation-surface.ts
var Bg = "model-consent";
function Vg(e) {
	return Gn(e, Bg);
}
function Hg(e) {
	return Wn(e);
}
function Ug(e, t) {
	return e !== null && t !== null && Un(e, t);
}
function Wg(e, t) {
	if (t || !Zn(e, "ask", "new")) return null;
	let n = {
		place: "ask",
		sub: "new"
	}, r = lr(e, n);
	return r !== null && Un(n, r) ? r : null;
}
function Gg(e, t, n) {
	if (n || t === null || t.place !== "ask" || t.sub !== void 0 && t.sub !== "new" && t.sub !== "saved") return null;
	let r = lr(e, t);
	return r !== null && Un(t, r) ? r : null;
}
function Kg(e, t) {
	let n = wr(t);
	if (n === null) return null;
	let r = rg({
		...e,
		question: n
	});
	if (r.continuationId !== void 0) throw TypeError("CONTINUATION_HOST_OWNED");
	return r;
}
//#endregion
//#region app/ui/src/patterns/model-disclosure-translation.ts
var qg = {
	question: "The complete question is included separately from evidence Shape. Review it for private names, amounts and instructions before approving.",
	definition: "Published calculation labels, definitions and parameter meanings are included separately from evidence Shape. Review definition text for private names, amounts and instructions before approving this exact payload.",
	continuation: "The complete retained original objective, clarification and any prior exchanges are included separately from evidence Shape, with your exact current reply. Review all prior text for private names, amounts and instructions before approving this exact payload.",
	synthesis: "The exact retained original objective, admitted claim text and derived tool summary are included separately from evidence Shape. Review private names, business details and instructions before approving this separate synthesis transfer once."
};
function Jg(e, t) {
	return t === qg[e] ? `ASK.consent.disclosure.${e}` : void 0;
}
var Y = {
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
}, Yg = {
	conversation: "planning",
	"conversation-synthesis": "final-writing"
};
function Xg({ title: e, children: t }) {
	return /* @__PURE__ */ (0, j.jsxs)("section", {
		className: Y.block,
		children: [/* @__PURE__ */ (0, j.jsx)("h3", {
			className: Y.label,
			children: e
		}), t]
	});
}
function Zg({ name: e, mono: t = !1, exact: n = !1, children: r }) {
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: Y.pair,
		children: [/* @__PURE__ */ (0, j.jsx)("dt", {
			className: Y.name,
			children: e
		}), /* @__PURE__ */ (0, j.jsx)("dd", {
			className: [
				Y.value,
				t ? "fig" : "",
				n ? Y.exact : ""
			].filter(Boolean).join(" "),
			children: r
		})]
	});
}
function Qg({ family: e, warning: t }) {
	let n = M(), r = Fn() === "hi" ? Jg(e, t) : void 0;
	return /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [r !== void 0 && /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)("p", {
		className: Y.exact,
		lang: "hi",
		children: n(r)
	}), /* @__PURE__ */ (0, j.jsx)("p", {
		className: Y.name,
		children: n("ASK.consent.disclosure.original")
	})] }), /* @__PURE__ */ (0, j.jsx)("p", {
		className: Y.exact,
		lang: r === void 0 ? void 0 : "en",
		children: t
	})] });
}
function $g({ preview: e }) {
	let t = M(), n = (0, _.useId)(), r = e.continuation;
	return /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [
		/* @__PURE__ */ (0, j.jsx)(Xg, {
			title: t("ASK.consent.warning.question"),
			children: /* @__PURE__ */ (0, j.jsx)(Qg, {
				family: "question",
				warning: e.questionDisclosureWarning
			})
		}),
		/* @__PURE__ */ (0, j.jsx)(Xg, {
			title: t("ASK.consent.warning.definition"),
			children: /* @__PURE__ */ (0, j.jsx)(Qg, {
				family: "definition",
				warning: e.definitionDisclosureWarning
			})
		}),
		/* @__PURE__ */ (0, j.jsx)(Xg, {
			title: t("ASK.consent.warning.calculation"),
			children: /* @__PURE__ */ (0, j.jsx)("p", {
				className: Y.exact,
				lang: "en",
				children: e.calculationParameterDisclosureWarning
			})
		}),
		e.continuationDisclosureWarning !== void 0 && /* @__PURE__ */ (0, j.jsx)(Xg, {
			title: t("ASK.consent.warning.continuation"),
			children: /* @__PURE__ */ (0, j.jsx)(Qg, {
				family: "continuation",
				warning: e.continuationDisclosureWarning
			})
		}),
		r !== void 0 && /* @__PURE__ */ (0, j.jsxs)(Xg, {
			title: t("ASK.consent.earlier"),
			children: [/* @__PURE__ */ (0, j.jsxs)("dl", {
				className: Y.pairs,
				children: [/* @__PURE__ */ (0, j.jsx)(Zg, {
					name: t("ASK.consent.earlier.question"),
					exact: !0,
					children: r.originalQuestion
				}), /* @__PURE__ */ (0, j.jsx)(Zg, {
					name: t("ASK.consent.earlier.clarification"),
					exact: !0,
					children: r.clarification
				})]
			}), r.exchanges !== void 0 && r.exchanges.length > 0 && /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)("p", {
				id: n,
				className: Y.name,
				children: t("ASK.consent.earlier.exchanges")
			}), /* @__PURE__ */ (0, j.jsx)("ol", {
				className: Y.exchanges,
				"aria-labelledby": n,
				children: r.exchanges.map((e, n) => /* @__PURE__ */ (0, j.jsx)("li", {
					className: Y.exchange,
					children: /* @__PURE__ */ (0, j.jsxs)("dl", {
						className: Y.pairs,
						children: [/* @__PURE__ */ (0, j.jsx)(Zg, {
							name: t("ASK.consent.exchange.question"),
							exact: !0,
							children: e.question
						}), /* @__PURE__ */ (0, j.jsx)(Zg, {
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
function e_({ preview: e }) {
	let t = M();
	return /* @__PURE__ */ (0, j.jsx)(Xg, {
		title: t("ASK.consent.warning.synthesis"),
		children: /* @__PURE__ */ (0, j.jsx)(Qg, {
			family: "synthesis",
			warning: e.synthesisDisclosureWarning
		})
	});
}
function t_({ stage: e, preview: t, origin: n, onClose: r, onSendReviewed: i, disabled: a = !1 }) {
	let o = M(), s = Yg[t.purpose], c = /* @__PURE__ */ (0, j.jsx)(Cr, {
		variant: "quiet",
		onClick: r,
		children: o("ASK.consent.cancel")
	});
	if (s !== e) return /* @__PURE__ */ (0, j.jsx)(yp, {
		kind: o("ASK.consent.kind"),
		title: o("ASK.consent.mismatch.title"),
		onClose: r,
		origin: n,
		actions: c,
		children: /* @__PURE__ */ (0, j.jsx)("p", {
			className: Y.note,
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
	return /* @__PURE__ */ (0, j.jsxs)(yp, {
		kind: o("ASK.consent.kind"),
		title: o(`ASK.consent.${s}.title`),
		onClose: r,
		origin: n,
		primary: l,
		actions: c,
		children: [
			/* @__PURE__ */ (0, j.jsx)("p", {
				className: Y.note,
				children: o(`ASK.consent.${s}.note`)
			}),
			/* @__PURE__ */ (0, j.jsx)(Xg, {
				title: o("ASK.consent.question"),
				children: /* @__PURE__ */ (0, j.jsx)("p", {
					className: Y.exact,
					children: t.naturalQuestion
				})
			}),
			t.purpose === "conversation" ? /* @__PURE__ */ (0, j.jsx)($g, { preview: t }) : /* @__PURE__ */ (0, j.jsx)(e_, { preview: t }),
			/* @__PURE__ */ (0, j.jsx)(Xg, {
				title: o("ASK.consent.details"),
				children: /* @__PURE__ */ (0, j.jsxs)("dl", {
					className: Y.pairs,
					children: [
						/* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.route"),
							mono: !0,
							children: t.routeId
						}),
						/* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.endpoint"),
							mono: t.endpoint !== void 0,
							children: t.endpoint === void 0 ? o("ASK.consent.endpoint.unknown") : t.endpoint
						}),
						/* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.level"),
							children: o(`ASK.consent.level.${t.send}`)
						}),
						/* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.boundary"),
							children: o(`ASK.consent.boundary.${t.receiptBoundary}`)
						}),
						/* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.observed"),
							children: o(t.providerPayloadObserved ? "ASK.consent.observed.yes" : "ASK.consent.observed.no")
						}),
						/* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.preview"),
							mono: !0,
							children: t.id
						}),
						/* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.digest"),
							mono: !0,
							children: t.digest
						}),
						t.purpose === "conversation" && t.continuationId !== void 0 && /* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.continuation.id"),
							mono: !0,
							children: t.continuationId
						}),
						t.purpose === "conversation" && t.continuationDigest !== void 0 && /* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.continuation.digest"),
							mono: !0,
							children: t.continuationDigest
						}),
						t.purpose === "conversation-synthesis" && /* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.synthesis.turn"),
							mono: !0,
							children: t.toolTurnId
						}),
						t.purpose === "conversation-synthesis" && /* @__PURE__ */ (0, j.jsx)(Zg, {
							name: o("ASK.consent.synthesis.digest"),
							mono: !0,
							children: t.synthesisInputDigest
						})
					]
				})
			}),
			/* @__PURE__ */ (0, j.jsx)(Xg, {
				title: o("ASK.consent.payload"),
				children: /* @__PURE__ */ (0, j.jsx)("pre", {
					className: [Y.payload, "fig"].join(" "),
					children: t.payload
				})
			})
		]
	});
}
var X = {
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
}, n_ = {
	"business.describe": "ASK.answer.tool.business",
	"calculator.calculate": "ASK.answer.tool.calculation"
}, r_ = {
	"business.describe": "ASK.answer.savedAnswer.business",
	"calculator.calculate": "ASK.answer.savedAnswer.calculation"
};
function Z({ name: e, mono: t = !1, children: n }) {
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: X.pair,
		children: [/* @__PURE__ */ (0, j.jsx)("dt", {
			className: X.name,
			children: e
		}), /* @__PURE__ */ (0, j.jsx)("dd", {
			className: [X.value, t ? "fig" : ""].filter(Boolean).join(" "),
			children: n
		})]
	});
}
function i_({ name: e, children: t }) {
	let n = (0, _.useId)();
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: X.group,
		children: [/* @__PURE__ */ (0, j.jsx)("p", {
			id: n,
			className: X.label,
			children: e
		}), /* @__PURE__ */ (0, j.jsx)("ul", {
			className: X.rows,
			"aria-labelledby": n,
			children: t
		})]
	});
}
function a_({ name: e, children: t }) {
	return /* @__PURE__ */ (0, j.jsxs)("details", {
		className: X.more,
		children: [/* @__PURE__ */ (0, j.jsx)("summary", {
			className: X.summary,
			children: e
		}), /* @__PURE__ */ (0, j.jsx)("div", {
			className: X.detail,
			children: t
		})]
	});
}
function o_({ name: e, children: t }) {
	let n = (0, _.useId)();
	return /* @__PURE__ */ (0, j.jsxs)("details", {
		className: X.more,
		children: [/* @__PURE__ */ (0, j.jsx)("summary", {
			id: n,
			className: X.summary,
			children: e
		}), /* @__PURE__ */ (0, j.jsx)("ul", {
			className: X.rows,
			"aria-labelledby": n,
			children: t
		})]
	});
}
function s_({ intent: e, onReference: t }) {
	return /* @__PURE__ */ (0, j.jsx)(Cr, {
		variant: "link",
		className: X.id,
		onClick: () => t(e),
		children: e.id
	});
}
function c_({ kind: e, ids: t, onReference: n }) {
	return t.length === 0 ? /* @__PURE__ */ (0, j.jsx)(Np, { missing: "none" }) : /* @__PURE__ */ (0, j.jsx)("span", {
		className: X.ids,
		children: t.map((t) => /* @__PURE__ */ (0, j.jsx)(s_, {
			intent: {
				kind: e,
				id: t
			},
			onReference: n
		}, t))
	});
}
function l_({ ids: e }) {
	return e.length === 0 ? /* @__PURE__ */ (0, j.jsx)(Np, { missing: "none" }) : /* @__PURE__ */ (0, j.jsx)("span", {
		className: X.ids,
		children: e.map((e) => /* @__PURE__ */ (0, j.jsx)("span", {
			className: X.id,
			children: e
		}, e))
	});
}
function u_(e, t) {
	return t.unit === "money" ? t.currency === void 0 ? e("ASK.answer.figure.money", { exact: t.minor }) : e("ASK.answer.figure.money.currency", {
		exact: t.minor,
		currency: t.currency
	}) : t.currency === void 0 ? e("ASK.answer.figure.points", { exact: t.minor }) : e("ASK.answer.figure.points.currency", {
		exact: t.minor,
		currency: t.currency
	});
}
function d_(e) {
	return e.coverage.completeness === "empty" || e.coverage.completeness === "partial" && e.coverage.countedRows === 0;
}
function f_({ figure: e, receiptId: t, onReference: n }) {
	let r = M();
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: X.pair,
		children: [/* @__PURE__ */ (0, j.jsx)("dt", { children: e.label }), /* @__PURE__ */ (0, j.jsx)("dd", {
			className: X.value,
			children: /* @__PURE__ */ (0, j.jsx)(Cr, {
				variant: "link",
				className: X.figure,
				title: r("FIGURE.title", {
					exact: e.minor,
					receipt: t
				}),
				"aria-label": r("ASK.answer.figure.open", {
					label: e.label,
					display: e.display,
					exact: u_(r, e),
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
function p_({ receipt: e, message: t, onReference: n }) {
	let r = M(), i = e.period, a = e.comparePeriod, o = d_(e), s = /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [t !== void 0 && /* @__PURE__ */ (0, j.jsx)("p", {
		className: X.text,
		children: t
	}), e.explanation !== "" && e.explanation !== t && /* @__PURE__ */ (0, j.jsx)("p", {
		className: X.text,
		children: e.explanation
	})] });
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: X.group,
		children: [
			!o && s,
			e.stale && /* @__PURE__ */ (0, j.jsxs)("p", {
				className: X.note,
				children: [
					/* @__PURE__ */ (0, j.jsx)(Op, { kind: "stale" }),
					" ",
					r("ST.stale.plain")
				]
			}),
			e.staleReason !== void 0 && /* @__PURE__ */ (0, j.jsx)("p", {
				className: X.note,
				children: e.staleReason
			}),
			o ? /* @__PURE__ */ (0, j.jsx)("dl", {
				className: X.figures,
				children: /* @__PURE__ */ (0, j.jsxs)("div", {
					className: X.pair,
					children: [/* @__PURE__ */ (0, j.jsx)("dt", { children: r("ASK.answer.calculation.figure") }), /* @__PURE__ */ (0, j.jsx)("dd", {
						className: X.value,
						children: /* @__PURE__ */ (0, j.jsx)(Np, { missing: "unknown" })
					})]
				})
			}) : e.figures.length > 0 ? /* @__PURE__ */ (0, j.jsx)("dl", {
				className: X.figures,
				children: e.figures.map((t) => /* @__PURE__ */ (0, j.jsx)(f_, {
					figure: t,
					receiptId: e.id,
					onReference: n
				}, t.key))
			}) : /* @__PURE__ */ (0, j.jsx)("p", {
				className: X.missing,
				children: r("ASK.answer.calculation.noFigures")
			}),
			/* @__PURE__ */ (0, j.jsx)("dl", {
				className: X.pairs,
				children: /* @__PURE__ */ (0, j.jsx)(Z, {
					name: r("ASK.answer.coverage.completeness"),
					children: r(`ASK.answer.coverage.completeness.${e.coverage.completeness}`)
				})
			}),
			e.coverage.gaps.length > 0 && /* @__PURE__ */ (0, j.jsx)(i_, {
				name: r("ASK.answer.coverage.gaps"),
				children: e.coverage.gaps.map((e, t) => /* @__PURE__ */ (0, j.jsx)("li", {
					className: X.row,
					children: /* @__PURE__ */ (0, j.jsx)("p", {
						className: X.text,
						children: e
					})
				}, t))
			}),
			/* @__PURE__ */ (0, j.jsxs)(a_, {
				name: r("ASK.answer.detail.calculation"),
				children: [o && s, /* @__PURE__ */ (0, j.jsxs)("dl", {
					className: X.pairs,
					children: [
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.calculation.operation"),
							mono: !0,
							children: e.operation
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.calculation.period"),
							children: i === null ? r("ASK.answer.notSpecified") : r("ASK.answer.period", {
								from: i.from,
								to: i.to
							})
						}),
						a !== null && /* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.calculation.comparePeriod"),
							children: r("ASK.answer.period", {
								from: a.from,
								to: a.to
							})
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.scope.branch"),
							children: e.branch ?? r("ASK.answer.notSpecified")
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.scope.asOf"),
							mono: !0,
							children: e.asOf
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.calculation.currency"),
							mono: !0,
							children: e.currency
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.sources"),
							children: /* @__PURE__ */ (0, j.jsx)(l_, { ids: e.sourceIds })
						}),
						e.requestedSourceIds !== void 0 && /* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.calculation.requestedSources"),
							children: /* @__PURE__ */ (0, j.jsx)(l_, { ids: e.requestedSourceIds })
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.coverage.selected"),
							mono: !0,
							children: e.coverage.selectedRows
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.coverage.counted"),
							mono: !0,
							children: e.coverage.countedRows
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.coverage.excluded"),
							mono: !0,
							children: e.coverage.excludedRows
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.coverage.conflicts"),
							mono: !0,
							children: e.coverage.unresolvedConflicts
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: r("ASK.answer.calculationReceipt"),
							children: /* @__PURE__ */ (0, j.jsx)(s_, {
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
function m_({ answer: e, onReference: t }) {
	return "supported" in e ? /* @__PURE__ */ (0, j.jsx)(p_, {
		receipt: e.receipt,
		message: e.message,
		onReference: t
	}) : /* @__PURE__ */ (0, j.jsx)(p_, {
		receipt: e,
		onReference: t
	});
}
function h_({ answer: e, onReference: t }) {
	let n = M(), r = e.claims.length === 0 && e.unknowns.length === 0 && e.conflicts.length === 0;
	return /* @__PURE__ */ (0, j.jsxs)("div", {
		className: X.group,
		children: [
			/* @__PURE__ */ (0, j.jsxs)("dl", {
				className: X.pairs,
				children: [
					/* @__PURE__ */ (0, j.jsx)(Z, {
						name: n("ASK.answer.status"),
						children: n(`ASK.answer.business.status.${e.status}`)
					}),
					/* @__PURE__ */ (0, j.jsx)(Z, {
						name: n("ASK.answer.scope.completeness"),
						children: n(`ASK.answer.scope.completeness.${e.scope.completeness}`)
					}),
					/* @__PURE__ */ (0, j.jsx)(Z, {
						name: n("ASK.answer.scope.synthetic"),
						children: n(e.scope.syntheticFixture ? "CHOICE.yes" : "CHOICE.no")
					})
				]
			}),
			r && e.message !== "" && /* @__PURE__ */ (0, j.jsx)("p", {
				className: X.text,
				children: e.message
			}),
			e.claims.length > 0 && /* @__PURE__ */ (0, j.jsx)(o_, {
				name: n("ASK.answer.business.claims"),
				children: e.claims.map((e) => /* @__PURE__ */ (0, j.jsxs)("li", {
					className: X.row,
					children: [
						/* @__PURE__ */ (0, j.jsx)("p", {
							className: X.text,
							children: e.text
						}),
						/* @__PURE__ */ (0, j.jsxs)("p", {
							className: X.tags,
							children: [
								/* @__PURE__ */ (0, j.jsx)("span", {
									className: X.tag,
									children: n(`ASK.answer.category.${e.category}`)
								}),
								/* @__PURE__ */ (0, j.jsx)("span", {
									className: X.tag,
									children: n(`ASK.answer.origin.${e.origin}`)
								}),
								/* @__PURE__ */ (0, j.jsx)("span", {
									className: X.tag,
									children: n(`ASK.answer.qualification.${e.qualification}`)
								})
							]
						}),
						/* @__PURE__ */ (0, j.jsx)("dl", {
							className: X.refs,
							children: /* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.refs.citations"),
								children: /* @__PURE__ */ (0, j.jsx)(c_, {
									kind: "citation",
									ids: e.citationIds,
									onReference: t
								})
							})
						})
					]
				}, e.id))
			}),
			e.unknowns.length > 0 && /* @__PURE__ */ (0, j.jsx)(o_, {
				name: n("ASK.answer.business.unknowns"),
				children: e.unknowns.map((e) => /* @__PURE__ */ (0, j.jsxs)("li", {
					className: X.row,
					children: [/* @__PURE__ */ (0, j.jsx)("p", {
						className: X.text,
						children: e.message
					}), /* @__PURE__ */ (0, j.jsx)("p", {
						className: X.tags,
						children: /* @__PURE__ */ (0, j.jsx)("span", {
							className: X.tag,
							children: n(`ASK.answer.category.${e.category}`)
						})
					})]
				}, e.category))
			}),
			e.conflicts.length > 0 && /* @__PURE__ */ (0, j.jsx)(o_, {
				name: n("ASK.answer.business.conflicts"),
				children: e.conflicts.map((e, r) => /* @__PURE__ */ (0, j.jsxs)("li", {
					className: X.row,
					children: [
						/* @__PURE__ */ (0, j.jsx)("p", {
							className: X.text,
							children: e.reason
						}),
						/* @__PURE__ */ (0, j.jsx)("p", {
							className: X.tags,
							children: /* @__PURE__ */ (0, j.jsx)("span", {
								className: X.tag,
								children: n(`ASK.answer.category.${e.category}`)
							})
						}),
						/* @__PURE__ */ (0, j.jsx)("dl", {
							className: X.refs,
							children: /* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.refs.citations"),
								children: /* @__PURE__ */ (0, j.jsx)(c_, {
									kind: "citation",
									ids: e.citationIds,
									onReference: t
								})
							})
						})
					]
				}, r))
			}),
			e.scope.limitations.length > 0 && /* @__PURE__ */ (0, j.jsx)(o_, {
				name: n("ASK.answer.business.limitations"),
				children: e.scope.limitations.map((e, t) => /* @__PURE__ */ (0, j.jsx)("li", {
					className: X.row,
					children: /* @__PURE__ */ (0, j.jsx)("p", {
						className: X.text,
						children: e
					})
				}, t))
			}),
			e.citations.length > 0 && /* @__PURE__ */ (0, j.jsx)(o_, {
				name: n("ASK.answer.business.citations"),
				children: e.citations.map((e) => /* @__PURE__ */ (0, j.jsx)("li", {
					className: X.row,
					children: /* @__PURE__ */ (0, j.jsxs)("dl", {
						className: X.refs,
						children: [
							/* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.citation"),
								children: /* @__PURE__ */ (0, j.jsx)(s_, {
									intent: {
										kind: "citation",
										id: e.id
									},
									onReference: t
								})
							}),
							/* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.citation.kind"),
								children: n(`ASK.answer.citation.kind.${e.kind}`)
							}),
							/* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.citation.path"),
								mono: !0,
								children: e.path
							}),
							e.sourceId !== void 0 && /* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.citation.source"),
								mono: !0,
								children: e.sourceId
							}),
							e.sourceRow !== void 0 && /* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.citation.row"),
								mono: !0,
								children: e.sourceRow
							}),
							e.branch !== void 0 && /* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.scope.branch"),
								children: e.branch
							}),
							e.validFrom !== void 0 && /* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.citation.validFrom"),
								mono: !0,
								children: e.validFrom
							}),
							e.validTo !== void 0 && /* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.citation.validTo"),
								mono: e.validTo !== null,
								children: e.validTo ?? n("ASK.answer.notSpecified")
							}),
							e.learnedAt !== void 0 && /* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.citation.learnedAt"),
								mono: !0,
								children: e.learnedAt
							})
						]
					})
				}, e.id))
			}),
			/* @__PURE__ */ (0, j.jsx)(a_, {
				name: n("ASK.answer.detail.business"),
				children: /* @__PURE__ */ (0, j.jsxs)("dl", {
					className: X.pairs,
					children: [
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: n("ASK.answer.scope.corpus"),
							children: n(`ASK.answer.scope.corpus.${e.scope.corpus}`)
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: n("ASK.answer.scope.branch"),
							children: e.scope.branch ?? n("ASK.answer.notSpecified")
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: n("ASK.answer.scope.asOf"),
							mono: !0,
							children: e.scope.asOf
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: n("ASK.answer.scope.onDate"),
							mono: !0,
							children: e.scope.onDate
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: n("ASK.answer.sources"),
							children: /* @__PURE__ */ (0, j.jsx)(l_, { ids: e.sourceIds })
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: n("ASK.answer.contextDigest"),
							mono: !0,
							children: e.contextDigest
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: n("ASK.answer.businessReceipt"),
							children: /* @__PURE__ */ (0, j.jsx)(s_, {
								intent: {
									kind: "business-context-receipt",
									id: e.receipt.id
								},
								onReference: t
							})
						}),
						e.receipt.modelReceiptId !== void 0 && /* @__PURE__ */ (0, j.jsx)(Z, {
							name: n("ASK.answer.modelReceipt"),
							children: /* @__PURE__ */ (0, j.jsx)(s_, {
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
function g_({ result: e, onReference: t }) {
	let n = M(), r = /* @__PURE__ */ (0, j.jsx)("h3", {
		className: X.tool,
		children: n(n_[e.tool])
	});
	return e.error === void 0 ? e.tool === "business.describe" ? /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [r, /* @__PURE__ */ (0, j.jsx)(h_, {
		answer: e.answer,
		onReference: t
	})] }) : /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [r, /* @__PURE__ */ (0, j.jsx)(p_, {
		receipt: e.answer,
		onReference: t
	})] }) : /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [
		r,
		/* @__PURE__ */ (0, j.jsx)("p", {
			className: X.note,
			children: n("ASK.answer.tool.error")
		}),
		/* @__PURE__ */ (0, j.jsx)("p", {
			className: X.text,
			children: e.error.message
		}),
		/* @__PURE__ */ (0, j.jsx)("p", {
			className: [X.code, "fig"].join(" "),
			children: n("ST.failed.code", { code: e.error.code })
		})
	] });
}
function __({ tools: e, onReference: t }) {
	let n = M(), r = (0, _.useId)();
	return /* @__PURE__ */ (0, j.jsxs)("section", {
		className: X.section,
		"aria-labelledby": r,
		children: [
			/* @__PURE__ */ (0, j.jsx)("h2", {
				id: r,
				className: X.label,
				children: n("ASK.answer.tools")
			}),
			/* @__PURE__ */ (0, j.jsx)("ol", {
				className: X.rows,
				children: e.results.map((e, n) => /* @__PURE__ */ (0, j.jsx)("li", {
					className: X.result,
					children: /* @__PURE__ */ (0, j.jsx)(g_, {
						result: e,
						onReference: t
					})
				}, n))
			}),
			/* @__PURE__ */ (0, j.jsx)(a_, {
				name: n("ASK.answer.detail.turn"),
				children: /* @__PURE__ */ (0, j.jsxs)("dl", {
					className: X.pairs,
					children: [
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: n("ASK.answer.toolReceipt"),
							children: /* @__PURE__ */ (0, j.jsx)(s_, {
								intent: {
									kind: "conversation-tool-receipt",
									id: e.receipt.id
								},
								onReference: t
							})
						}),
						/* @__PURE__ */ (0, j.jsx)(Z, {
							name: n("ASK.answer.modelReceipt"),
							children: /* @__PURE__ */ (0, j.jsx)(s_, {
								intent: {
									kind: "model-receipt",
									id: e.modelReceiptId
								},
								onReference: t
							})
						}),
						e.receipt.resultRefs.map((e) => /* @__PURE__ */ (0, j.jsx)(Z, {
							name: n(r_[e.tool]),
							children: /* @__PURE__ */ (0, j.jsx)(s_, {
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
function v_({ reference: e, onReference: t }) {
	let n = M();
	return /* @__PURE__ */ (0, j.jsxs)("dl", {
		className: X.refs,
		children: [
			/* @__PURE__ */ (0, j.jsx)(Z, {
				name: n("ASK.answer.refs.evidence"),
				children: /* @__PURE__ */ (0, j.jsx)(c_, {
					kind: "evidence",
					ids: e.evidenceRefs,
					onReference: t
				})
			}),
			/* @__PURE__ */ (0, j.jsx)(Z, {
				name: n("ASK.answer.refs.answers"),
				children: /* @__PURE__ */ (0, j.jsx)(c_, {
					kind: "answer",
					ids: e.answerIds,
					onReference: t
				})
			}),
			/* @__PURE__ */ (0, j.jsx)(Z, {
				name: n("ASK.answer.refs.receipts"),
				children: /* @__PURE__ */ (0, j.jsx)(c_, {
					kind: "receipt",
					ids: e.receiptIds,
					onReference: t
				})
			}),
			/* @__PURE__ */ (0, j.jsx)(Z, {
				name: n("ASK.answer.refs.citations"),
				children: /* @__PURE__ */ (0, j.jsx)(c_, {
					kind: "citation",
					ids: e.citationIds,
					onReference: t
				})
			})
		]
	});
}
function y_({ answer: e, onReference: t }) {
	let n = M(), r = (0, _.useId)(), i = e.receipt;
	return /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [
		/* @__PURE__ */ (0, j.jsxs)("section", {
			className: X.section,
			"aria-labelledby": r,
			children: [
				/* @__PURE__ */ (0, j.jsx)("h2", {
					id: r,
					className: X.label,
					children: n("ASK.answer.written")
				}),
				e.paragraphs.map((n, r) => {
					let i = e.references[r];
					return /* @__PURE__ */ (0, j.jsxs)("div", {
						className: X.paragraph,
						children: [/* @__PURE__ */ (0, j.jsx)("p", {
							className: X.text,
							children: n
						}), i !== void 0 && /* @__PURE__ */ (0, j.jsx)(v_, {
							reference: i,
							onReference: t
						})]
					}, r);
				}),
				e.cautions.length > 0 && /* @__PURE__ */ (0, j.jsx)(i_, {
					name: n("ASK.answer.cautions"),
					children: e.cautions.map((e) => /* @__PURE__ */ (0, j.jsxs)("li", {
						className: X.row,
						children: [/* @__PURE__ */ (0, j.jsx)("p", {
							className: X.text,
							children: e.text
						}), /* @__PURE__ */ (0, j.jsx)("dl", {
							className: X.refs,
							children: /* @__PURE__ */ (0, j.jsx)(Z, {
								name: n("ASK.answer.refs.evidence"),
								children: /* @__PURE__ */ (0, j.jsx)(s_, {
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
		/* @__PURE__ */ (0, j.jsx)(__, {
			tools: e.tools,
			onReference: t
		}),
		/* @__PURE__ */ (0, j.jsx)(a_, {
			name: n("ASK.answer.synthesisReceipt"),
			children: /* @__PURE__ */ (0, j.jsxs)("dl", {
				className: X.pairs,
				children: [
					/* @__PURE__ */ (0, j.jsx)(Z, {
						name: n("ASK.answer.synthesisReceipt.id"),
						children: /* @__PURE__ */ (0, j.jsx)(Cr, {
							variant: "link",
							className: X.id,
							onClick: () => t({
								kind: "synthesis-receipt",
								receipt: i
							}),
							children: i.id
						})
					}),
					/* @__PURE__ */ (0, j.jsx)(Z, {
						name: n("ASK.answer.synthesisReceipt.toolTurn"),
						children: /* @__PURE__ */ (0, j.jsx)("span", {
							className: X.id,
							children: i.toolTurnId
						})
					}),
					/* @__PURE__ */ (0, j.jsx)(Z, {
						name: n("ASK.answer.synthesisReceipt.planner"),
						children: /* @__PURE__ */ (0, j.jsx)(s_, {
							intent: {
								kind: "model-receipt",
								id: i.plannerModelReceiptId
							},
							onReference: t
						})
					}),
					/* @__PURE__ */ (0, j.jsx)(Z, {
						name: n("ASK.answer.synthesisReceipt.writer"),
						children: /* @__PURE__ */ (0, j.jsx)(s_, {
							intent: {
								kind: "model-receipt",
								id: i.synthesisModelReceiptId
							},
							onReference: t
						})
					}),
					/* @__PURE__ */ (0, j.jsx)(Z, {
						name: n("ASK.answer.synthesisReceipt.input"),
						children: /* @__PURE__ */ (0, j.jsx)("span", {
							className: X.id,
							children: i.inputDigest
						})
					}),
					/* @__PURE__ */ (0, j.jsx)(Z, {
						name: n("ASK.answer.synthesisReceipt.output"),
						children: /* @__PURE__ */ (0, j.jsx)("span", {
							className: X.id,
							children: i.outputDigest
						})
					})
				]
			})
		})
	] });
}
function b_({ answer: e, onAnswer: t, onReference: n }) {
	let r = M(), i = (0, _.useId)(), a = t;
	return /* @__PURE__ */ (0, j.jsxs)("section", {
		className: X.section,
		"aria-labelledby": i,
		children: [
			/* @__PURE__ */ (0, j.jsx)("h2", {
				id: i,
				className: X.label,
				children: r("ASK.answer.clarification")
			}),
			/* @__PURE__ */ (0, j.jsx)("p", {
				className: X.text,
				children: e.clarification
			}),
			a !== void 0 && /* @__PURE__ */ (0, j.jsx)("div", {
				className: X.actions,
				children: /* @__PURE__ */ (0, j.jsx)(Cr, {
					variant: "quiet",
					onClick: () => a(),
					children: r("ASK.answer.continue")
				})
			}),
			/* @__PURE__ */ (0, j.jsx)("dl", {
				className: X.pairs,
				children: /* @__PURE__ */ (0, j.jsx)(Z, {
					name: r("ASK.answer.modelReceipt"),
					children: /* @__PURE__ */ (0, j.jsx)(s_, {
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
function x_({ tool: e, children: t }) {
	let n = M(), r = (0, _.useId)();
	return /* @__PURE__ */ (0, j.jsxs)("section", {
		className: X.section,
		"aria-labelledby": r,
		children: [/* @__PURE__ */ (0, j.jsx)("h2", {
			id: r,
			className: X.label,
			children: n(n_[e])
		}), t]
	});
}
function S_({ saved: e, onPreviewFinalWriting: t, onContinue: n, onReference: r }) {
	let i = M(), a = (0, _.useId)(), o = n, s = t;
	return /* @__PURE__ */ (0, j.jsxs)("article", {
		className: X.answer,
		"aria-labelledby": a,
		children: [
			/* @__PURE__ */ (0, j.jsx)("h1", {
				id: a,
				className: X.question,
				children: e.question
			}),
			(() => {
				switch (e.kind) {
					case "clarification": return /* @__PURE__ */ (0, j.jsx)(b_, {
						answer: e.answer,
						onAnswer: o === void 0 ? void 0 : () => o(e.id),
						onReference: r
					});
					case "grounded-conversation": return /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)(__, {
						tools: e.answer,
						onReference: r
					}), s !== void 0 && /* @__PURE__ */ (0, j.jsxs)("div", {
						className: X.actions,
						children: [/* @__PURE__ */ (0, j.jsx)(Cr, {
							variant: "quiet",
							onClick: () => s(),
							children: i("ASK.answer.previewWriting")
						}), /* @__PURE__ */ (0, j.jsx)("span", {
							className: X.note,
							children: i("ASK.answer.previewWriting.note")
						})]
					})] });
					case "synthesized-conversation": return /* @__PURE__ */ (0, j.jsx)(y_, {
						answer: e.answer,
						onReference: r
					});
					case "business-context": return /* @__PURE__ */ (0, j.jsx)(x_, {
						tool: "business.describe",
						children: /* @__PURE__ */ (0, j.jsx)(h_, {
							answer: e.answer,
							onReference: r
						})
					});
					case "calculation": return /* @__PURE__ */ (0, j.jsx)(x_, {
						tool: "calculator.calculate",
						children: /* @__PURE__ */ (0, j.jsx)(m_, {
							answer: e.answer,
							onReference: r
						})
					});
				}
			})(),
			/* @__PURE__ */ (0, j.jsx)(a_, {
				name: i("ASK.answer.detail.saved"),
				children: /* @__PURE__ */ (0, j.jsxs)("dl", {
					className: X.pairs,
					children: [/* @__PURE__ */ (0, j.jsx)(Z, {
						name: i("ASK.answer.saved.id"),
						children: /* @__PURE__ */ (0, j.jsx)("span", {
							className: X.id,
							children: e.id
						})
					}), /* @__PURE__ */ (0, j.jsx)(Z, {
						name: i("ASK.answer.saved.at"),
						mono: !0,
						children: /* @__PURE__ */ (0, j.jsx)("time", {
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
function C_({ state: e, savedPlace: t, onContinue: n, onPreviewFinalWriting: r, onReference: i }) {
	let a = M(), o;
	switch (e.kind) {
		case "answer":
			o = /* @__PURE__ */ (0, j.jsx)(S_, {
				saved: e.saved,
				onContinue: n,
				onPreviewFinalWriting: r,
				onReference: i
			});
			break;
		case "continuation":
			o = /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)("p", { children: e.value.clarification }), /* @__PURE__ */ (0, j.jsx)("p", { children: a("ASK.workspace.continuation") })] });
			break;
		case "busy":
			o = /* @__PURE__ */ (0, j.jsx)("p", {
				role: "status",
				children: a("ASK.workspace.busy")
			});
			break;
		case "review":
			o = /* @__PURE__ */ (0, j.jsx)("p", { children: a("ASK.workspace.review") });
			break;
		case "unavailable":
			o = /* @__PURE__ */ (0, j.jsx)("p", {
				role: "status",
				children: a("ASK.workspace.unavailable", { code: e.code })
			});
			break;
		case "idle": o = /* @__PURE__ */ (0, j.jsx)("p", { children: a("ASK.workspace.empty") });
	}
	return /* @__PURE__ */ (0, j.jsxs)("section", {
		"aria-label": a("SH-01.place.ask"),
		children: [e.kind !== "answer" && /* @__PURE__ */ (0, j.jsx)(zp, {
			where: a("SH-01.place.ask"),
			title: a(t ? "SH-01.sub.ask.saved" : "SH-01.sub.ask.new")
		}), o]
	});
}
function w_({ app: e, conversation: t, questionSettings: n, contextKey: r, readback: i, onReference: a }) {
	let o = (0, _.useSyncExternalStore)(t.subscribe, t.snapshot, t.snapshot), [s, c] = (0, _.useState)(null), l = (0, _.useRef)(null), u = (0, _.useRef)(null), d = (0, _.useRef)(null), f = (0, _.useRef)(r), p = (0, _.useRef)(n), m = (0, _.useRef)(t), h = (0, _.useRef)(null), g = {
		kind: e.shellKind,
		view: e.view,
		administers: e.administers,
		allowed: e.allowed
	}, v = e.lock != null || dr(e.today.data.state), y = f.current === r && p.current === n && m.current === t, b = y ? Gg(g, s, v) : null;
	(0, _.useLayoutEffect)(() => {
		(f.current !== r || p.current !== n || m.current !== t) && (f.current = r, p.current = n, m.current = t, h.current = null, u.current = null, t.invalidate());
	}, [
		r,
		n,
		t
	]), (0, _.useLayoutEffect)(() => () => {
		u.current = null, h.current = null, t.invalidate();
	}, [t]), (0, _.useLayoutEffect)(() => {
		u.current !== null && Gg(g, u.current, v) === null && (u.current = null, h.current = null, t.invalidate(v ? "VAULT_LOCKED" : "ACCESS_DENIED"));
	}, [
		t,
		v,
		e.allowed,
		e.administers,
		e.shellKind,
		e.view
	]);
	let x = (e) => {
		window.location.hash = Hn(e);
	}, S = (e) => {
		u.current = e, x(e);
	}, C = () => {
		d.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	}, w = (0, _.useCallback)((n) => {
		l.current = n, c((e) => e === null && n === null || e !== null && n !== null && Un(e, n) ? e : n), u.current !== null && !Ug(u.current, n) && (u.current = null, h.current = null, t.invalidate()), e.onAddress?.(n);
	}, [t, e.onAddress]), T = (e) => {
		let r = Wg(g, v);
		if (r === null || !y) {
			u.current = null, t.invalidate("ACCESS_DENIED");
			return;
		}
		try {
			let i = Kg(n, e);
			if (i === null) return;
			C(), S(Vg(r)), t.preview(i);
		} catch {
			S(Hg(r)), t.invalidate("INVALID_REPLY");
		}
	}, ee = (n) => {
		let r = u.current;
		r !== null && S(Hg(r)), t.editQuestion(), e.ask.onChange?.(n);
	}, E = () => {
		let e = u.current;
		e !== null && S(Hg(e)), t.cancel();
	}, te = (e) => {
		if (b === null || !Ug(u.current, b)) {
			u.current = null, t.invalidate("ACCESS_DENIED");
			return;
		}
		S(Hg(b)), t.sendReviewed(e);
	}, ne = (e) => {
		let n = Gg(g, l.current, v);
		n !== null && Ug(u.current, n) && (S(Hg(n)), t.selectContinuation(e));
	}, D = () => {
		let e = Gg(g, l.current, v);
		e !== null && Ug(u.current, e) && (C(), S(Vg(e)), t.previewFinalWriting());
	}, re = i === void 0 ? null : Hn(i.address), ie = i === void 0 ? null : JSON.stringify([
		i.id,
		i.selectionKey,
		re
	]), ae = s === null ? null : Hn(s);
	(0, _.useLayoutEffect)(() => {
		if (i === void 0) {
			l.current?.place === "ask" && l.current.sub === "saved" && u.current !== null && (u.current = null, h.current = null, t.invalidate());
			return;
		}
		if (h.current !== null && h.current !== ie && (u.current = null, h.current = null, t.invalidate()), h.current === ie || re !== ae || !y) return;
		let e = Gg(g, l.current, v);
		e !== null && e.sub === "saved" && (h.current = ie, u.current = e, t.open(i.id));
	}, [
		t,
		i?.id,
		i?.selectionKey,
		re,
		ae,
		y,
		v,
		e.allowed,
		e.shellKind,
		e.view,
		e.administers
	]);
	let oe = b?.sub !== "saved" || i !== void 0 && h.current === ie, se = b !== null && oe && Ug(u.current, b), ce = se && o.kind === "review" ? {
		address: b,
		content: /* @__PURE__ */ (0, j.jsx)(t_, {
			stage: o.stage,
			preview: o.preview,
			origin: d.current,
			onClose: E,
			onSendReviewed: te
		})
	} : e.sheet, le = (t) => {
		if (Gg(g, t, v) === null) return e.renderPlace?.(t);
		let n = se && Ug(b, t) && h.current === ie;
		if (t.sub === "saved" && (i === void 0 || !Un(t, i.address) && !n)) return e.renderPlace?.(t);
		let r = se && Ug(b, t) ? o : { kind: "idle" };
		return /* @__PURE__ */ (0, j.jsx)(C_, {
			state: r,
			savedPlace: t.sub === "saved",
			onContinue: ne,
			onPreviewFinalWriting: D,
			onReference: (e) => {
				r.kind === "answer" && a(e, r.saved);
			}
		});
	}, ue = e.onHelp === void 0 ? void 0 : (n, r) => {
		if (v || !y) return;
		let i = o.kind === "review" || o.kind === "busy" ? d.current : n;
		u.current = null, h.current = null, t.cancel(), e.onHelp?.(i, r);
	};
	return /* @__PURE__ */ (0, j.jsx)(Jm, {
		...e,
		ask: {
			...e.ask,
			onAsk: T,
			onChange: ee
		},
		onAddress: w,
		renderPlace: le,
		sheet: ce,
		onHelp: ue
	}, r);
}
//#endregion
//#region app/ui/src/bridge/client.ts
var T_ = /* @__PURE__ */ "INVALID_REPLY.READ_INVALIDATED.ACCESS_DENIED.VAULT_LOCKED.UNAUTHENTICATED.EVIDENCE_UNAVAILABLE.ACCESS_REVOKED.SOURCE_REVOKED.BRANCH_FORBIDDEN.RECEIPT_FORBIDDEN.FORBIDDEN.RECEIPT_NOT_FOUND.INVALID_SESSION.ROUTE_REVOKED.OUTBOUND_APPROVAL_REQUIRED.CONVERSATION_CONTINUATION_RESOLVED.CONVERSATION_CONTINUATION_LIMIT.PREVIEW_STALE.PAYLOAD_CHANGED.PREVIEW_REQUEST_CHANGED.SYNTHESIS_STALE.CONVERSATION_CONTINUATION_STALE.MODEL_RECEIPT_EXPIRED.CALCULATION_STALE.CONVERSATION_NOT_FOUND.CONVERSATION_CONTINUATION_UNAVAILABLE.MODEL_RECEIPT_NOT_FOUND.SYNTHESIS_UNAVAILABLE.INVALID_REQUEST.REQUEST_TOO_LARGE.UNTRUSTED_SENDER.REQUEST_FAILED".split(".");
function E_(e, t) {
	if (typeof e != "object" || !e || Object.getPrototypeOf(e) !== Object.prototype) return null;
	let n = Reflect.ownKeys(e);
	if (n.length !== t.length || n.some((e) => typeof e != "string" || !t.includes(e))) return null;
	let r = Object.getOwnPropertyDescriptors(e);
	return t.some((e) => !r[e]?.enumerable || !Object.hasOwn(r[e], "value")) ? null : r;
}
function D_(e) {
	return Object.assign(/* @__PURE__ */ Error("The desktop request failed."), { code: e });
}
function O_(e) {
	let t = "REQUEST_FAILED";
	try {
		let n = E_(e, [
			"version",
			"ok",
			"result"
		]);
		if (n?.version?.value === 1 && n.ok?.value === !0) return n.result.value;
		let r = E_(e, [
			"version",
			"ok",
			"error"
		]);
		if (r?.version?.value === 1 && r.ok?.value === !1) {
			let e = E_(r.error.value, ["code"]), n = T_.find((t) => t === e?.code?.value);
			n && (t = n);
		}
	} catch {}
	throw D_(t);
}
function k_(e) {
	return Object.freeze({ async request(t, n = {}) {
		let r;
		try {
			r = await e.requestEnvelope(t, n);
		} catch {
			throw D_("REQUEST_FAILED");
		}
		return O_(r);
	} });
}
function A_(e) {
	if (typeof e != "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,199}$/.test(e)) throw new Ym("request.id");
}
var j_ = [
	"ACCESS_DENIED",
	"VAULT_LOCKED",
	"UNAUTHENTICATED",
	"EVIDENCE_UNAVAILABLE"
];
function M_(e) {
	return j_.includes(e);
}
function N_(e) {
	if (e instanceof Ym) return "INVALID_REPLY";
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
		...j_
	].find((e) => e === n) || (n === "VAULT_LOCKED" ? "VAULT_LOCKED" : n === "UNAUTHENTICATED" || n === "authentication_required" ? "UNAUTHENTICATED" : typeof n == "string" && [
		"ACCESS_REVOKED",
		"SOURCE_REVOKED",
		"BRANCH_FORBIDDEN",
		"RECEIPT_FORBIDDEN",
		"FORBIDDEN",
		"authority_denied"
	].includes(n) ? "ACCESS_DENIED" : n === "RECEIPT_NOT_FOUND" || n === "not_found" || n === "model_artifact_unavailable" ? "EVIDENCE_UNAVAILABLE" : "REQUEST_FAILED");
}
async function P_(e, t, n, r) {
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
		let t = N_(e);
		return M_(t) && r(), Object.freeze({
			ok: !1,
			code: t
		});
	}
}
function F_(e) {
	let t = Symbol();
	return Object.freeze({
		environment: "desktop",
		invalidate() {
			t = Symbol();
		},
		receipt(n) {
			let r = t;
			return P_(() => (A_(n), e.request("receipts.get", { id: n })), (e) => {
				let t = Oh(e);
				if (t.id !== n) throw new Ym("receipt.id");
				return t;
			}, () => t === r, () => {
				t = Symbol();
			});
		}
	});
}
//#endregion
//#region app/ui/src/bridge/projections.ts
var I_ = class extends Error {
	code = "UNSUPPORTED_PRESENTATION_UNIT";
	constructor() {
		super("UNSUPPORTED_PRESENTATION_UNIT"), this.name = "UnsupportedPresentationUnitError";
	}
};
function L_(e, t, n = []) {
	let r = Dh(e), i = r.figures.find((e) => e.key === t);
	if (!i) throw new Ym("receipt.figures.key");
	if (n.some((e) => e !== "stale") || n.includes("stale") && !r.stale) throw new Ym("receipt.labels");
	if (r.coverage.completeness === "empty" || r.coverage.completeness === "partial" && r.coverage.countedRows === 0) return Th({
		kind: "missing",
		state: "unknown"
	});
	let a = {
		receiptId: r.id,
		labels: r.stale ? ["stale"] : []
	};
	if (i.unit === "basis-points") return Th({
		kind: "percent",
		basisPoints: i.minor,
		...a
	});
	if (i.currency !== "INR" || r.currency !== "INR") throw new I_();
	return Th({
		kind: "money",
		currency: "INR",
		paise: i.minor,
		...a
	});
}
//#endregion
//#region app/ui/src/format/money.ts
function R_(e) {
	return rh(e), BigInt(e);
}
function z_(e) {
	if (!/^\d+$/.test(e)) throw TypeError("INVALID_FORMAT_VALUE");
	let t = BigInt(e).toString();
	return t.length <= 3 ? t : `${t.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${t.slice(-3)}`;
}
function B_(e) {
	let t = R_(e), n = t < 0n ? -t : t, r = n % 100n;
	return `${t < 0n ? "-" : ""}\u20b9${z_((n / 100n).toString())}${r === 0n ? "" : `.${r.toString().padStart(2, "0")}`}`;
}
function V_(e, t) {
	if (t.underHundred.length !== 100 || t.underHundred.some((e) => typeof e != "string" || e.length === 0)) throw TypeError("INVALID_FORMAT_WORDS");
	if (e < 100n) return t.underHundred[Number(e)];
	for (let [n, r] of [
		[10000000n, t.crore],
		[100000n, t.lakh],
		[1000n, t.thousand],
		[100n, t.hundred]
	]) if (e >= n) return `${V_(e / n, t)} ${r}${e % n ? ` ${V_(e % n, t)}` : ""}`;
	throw TypeError("INVALID_FORMAT_VALUE");
}
function H_(e, t) {
	let n = R_(e), r = n < 0n ? -n : n;
	return `${n < 0n ? `${t.minus} ` : ""}${V_(r / 100n, t)} ${t.rupees}${r % 100n ? ` ${t.and} ${V_(r % 100n, t)} ${t.paise}` : ""}`;
}
//#endregion
//#region app/ui/src/format/counts.ts
function U_(e) {
	return rh(e, "count", !1), z_(e);
}
function W_(e) {
	return `${G_(e)}%`;
}
function G_(e) {
	rh(e, "basisPoints");
	let t = BigInt(e), n = ((t < 0n ? -t : t) + 5n) / 10n;
	return `${t < 0n && n !== 0n ? "-" : ""}${z_((n / 10n).toString())}${n % 10n ? `.${n % 10n}` : ""}`;
}
//#endregion
//#region app/ui/src/format/dates.ts
function K_(e, t = "short", n = "en") {
	oh(e);
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
function q_(e, t) {
	return sh(e), new Intl.DateTimeFormat("en-IN", {
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		timeZone: t
	}).format(new Date(e));
}
//#endregion
//#region app/ui/src/format/index.ts
function J_(e, t) {
	if (Th({
		kind: "missing",
		state: e
	}), typeof t[e] != "string" || t[e].trim().length === 0) throw TypeError("MISSING_FORMAT_WORD");
	return t[e];
}
function Y_(e, t) {
	let n = Th(e);
	switch (n.kind) {
		case "money": return B_(n.paise);
		case "count": return U_(n.count);
		case "percent": return W_(n.basisPoints);
		case "missing": return J_(n.state, t);
	}
}
//#endregion
//#region app/ui/src/bridge/project-ui.ts
function X_(e) {
	return e && typeof e == "object" && (Object.values(e).forEach(X_), Object.freeze(e)), e;
}
function Z_(e) {
	if (!["en", "hi"].includes(e.language) || typeof e.timeZone != "string" || !e.timeZone || e.maxStats !== void 0 && ![
		3,
		4,
		12
	].includes(e.maxStats)) throw new Ym("format.context");
	try {
		new Intl.DateTimeFormat("en-IN", { timeZone: e.timeZone });
	} catch {
		throw new Ym("format.timeZone");
	}
}
function Q_(e, t) {
	if (e.kind === "missing") return {
		kind: "missing",
		missing: e.state
	};
	let n = Y_(e, t.missingWords), r = e.kind === "money" ? e.paise : e.kind === "count" ? e.count : e.basisPoints, i = {
		kind: e.kind,
		exact: r,
		display: n,
		receiptId: e.receiptId,
		labels: [...e.labels]
	};
	return e.kind === "money" ? t.spokenMoneyWords ? {
		...i,
		spoken: H_(e.paise, t.spokenMoneyWords)
	} : i : {
		...i,
		spoken: n
	};
}
function $_(e, t) {
	return Z_(t), e !== null && rh(e, "metadata.count", !1), X_({
		exact: e,
		display: e === null ? J_("unknown", t.missingWords) : U_(e)
	});
}
function ev(e, t) {
	let n = {
		id: e.id,
		mark: e.mark,
		what: e.title,
		note: e.note,
		...e.figure ? { figure: Q_(e.figure, t) } : {},
		...e.action ? { can: ["open"] } : {}
	};
	return e.action ? {
		row: n,
		action: e.action
	} : { row: n };
}
function tv(e, t) {
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
		value: Q_(e.value, t)
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
	throw new Ym("chart.kind");
}
function nv(e, t) {
	let n = tv(e.chart, t);
	return {
		tile: {
			id: e.id,
			label: e.label,
			figure: Q_(e.figure, t),
			chartState: n.state === "available" ? { state: "available" } : n,
			...e.change ? { change: Q_(e.change, t) } : {},
			...e.changeLabel ? { changeLabel: e.changeLabel } : {},
			...n.state === "available" ? { chart: n.chart } : {}
		},
		chartState: n
	};
}
function rv(e, t) {
	Z_(t);
	let n = Eh(e);
	if (n.stats.length > (t.maxStats ?? 3)) throw new Ym("today.stats.layout-limit");
	let r = n.attention.map((e) => ev(e, t)), i = n.worthLook.map((e) => ev(e, t)), a = n.stats.map((e) => nv(e, t)), o = [...r, ...i].flatMap((e) => e.action ? [{
		rowId: e.row.id,
		intent: e.action
	}] : []);
	return X_({
		title: n.title,
		data: {
			state: n.state.kind === "ready" || n.state.kind === "empty" ? { kind: n.state.kind } : {
				kind: "boundary-state",
				source: n.state
			},
			date: K_(n.date, "long", t.language),
			review: {
				count: $_(n.pendingCount, t),
				rows: r.map((e) => e.row)
			},
			worthALook: i.map((e) => e.row),
			thisMonth: a.map((e) => e.tile),
			...a.length === 0 ? { thisMonthMissing: "unknown" } : {},
			earlierToday: n.dayEvents.map((e) => ({
				id: e.id,
				mark: e.mark,
				time: q_(e.at, t.timeZone),
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
var iv = [
	"billed",
	"received",
	"earned",
	"margin"
], av = [
	"billed",
	"received",
	"net_sales",
	"margin",
	"aging"
], ov = {
	pendingCount: "TODAY_PENDING_COUNT_NOT_PROVIDED",
	attention: "TODAY_ATTENTION_CONTRACT_NOT_PROVIDED",
	worthLook: "TODAY_WORTH_LOOK_CONTRACT_NOT_PROVIDED",
	dayEvents: "TODAY_DAY_EVENTS_CONTRACT_NOT_PROVIDED",
	charts: "TODAY_CHART_SERIES_NOT_PROVIDED"
};
function Q(e) {
	throw new Ym(e);
}
function sv(e) {
	return e && typeof e == "object" && (Object.values(e).forEach(sv), Object.freeze(e)), e;
}
function cv(e, t, n = 0, r = {
	remaining: 2e5,
	characters: 8e6
}) {
	if ((n > 16 || --r.remaining < 0) && Q(t), e === null || typeof e == "boolean") return;
	if (typeof e == "string") {
		r.characters -= e.length, (e.length > 2e6 || r.characters < 0) && Q(t);
		return;
	}
	if (typeof e == "number") {
		Number.isFinite(e) || Q(t);
		return;
	}
	(!e || typeof e != "object" || Object.getOwnPropertySymbols(e).length > 0) && Q(t);
	let i = Object.getOwnPropertyDescriptors(e);
	if (Array.isArray(e)) {
		(Object.getPrototypeOf(e) !== Array.prototype || e.length > 1e4) && Q(t), Object.keys(i).some((e) => e !== "length" && !/^(?:0|[1-9]\d*)$/.test(e)) && Q(t);
		for (let a = 0; a < e.length; a++) {
			let e = i[String(a)];
			(!e || !Object.hasOwn(e, "value")) && Q(t), cv(e.value, t, n + 1, r);
		}
		return;
	}
	(Object.getPrototypeOf(e) !== Object.prototype || Object.keys(i).length > 1e3) && Q(t);
	for (let [e, a] of Object.entries(i)) ([
		"__proto__",
		"prototype",
		"constructor"
	].includes(e) || !a.enumerable || !Object.hasOwn(a, "value")) && Q(t), cv(a.value, t, n + 1, r);
}
function lv(e, t, n, r = []) {
	(!e || typeof e != "object" || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype) && Q(t);
	let i = e;
	return (n.some((e) => !Object.hasOwn(i, e)) || Object.keys(i).some((e) => !n.includes(e) && !r.includes(e))) && Q(t), i;
}
function uv(e, t, n = 8e3) {
	(typeof e != "string" || !e.trim() || e.length > n || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(e)) && Q(t);
}
function dv(e, t) {
	(typeof e != "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(e)) && Q(t);
}
function fv(e, t) {
	(typeof e != "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(e)) && Q(t);
}
function pv(e, t, n) {
	(!Array.isArray(e) || e.length > n) && Q(t);
}
function mv(e, t) {
	new Set(e).size !== e.length && Q(t);
}
function hv(e, t) {
	let n = lv(e, t, ["from", "to"]);
	return oh(n.from, t), oh(n.to, t), n.from > n.to && Q(t), {
		from: n.from,
		to: n.to
	};
}
function gv(e, t) {
	if (Object.is(e, t)) return !0;
	if (!e || !t || typeof e != "object" || typeof t != "object") return !1;
	if (Array.isArray(e) || Array.isArray(t)) return Array.isArray(e) && Array.isArray(t) && e.length === t.length && e.every((e, n) => gv(e, t[n]));
	let n = e, r = t;
	return Object.keys(n).length === Object.keys(r).length && Object.keys(n).every((e) => Object.hasOwn(r, e) && gv(n[e], r[e]));
}
function _v(e, t) {
	cv(e, "today.input");
	let n = lv(e, "today.input", [
		"title",
		"date",
		"request",
		"selections"
	]);
	uv(n.title, "today.title"), oh(n.date, "today.date");
	let r = lv(n.request, "today.request", [], t === "dashboard" ? ["period"] : [
		"period",
		"asOf",
		"branch",
		"customerId",
		"orderId",
		"sourceIds",
		"onDate",
		"ritual"
	]);
	Object.hasOwn(r, "period") && hv(r.period, "today.request.period"), Object.hasOwn(r, "asOf") && sh(r.asOf, "today.request.asOf"), Object.hasOwn(r, "onDate") && oh(r.onDate, "today.request.onDate");
	for (let e of [
		"branch",
		"customerId",
		"orderId"
	]) Object.hasOwn(r, e) && uv(r[e], `today.request.${e}`, 200);
	Object.hasOwn(r, "ritual") && r.ritual !== "monday" && r.ritual !== "friday" && Q("today.request.ritual"), Object.hasOwn(r, "sourceIds") && (pv(r.sourceIds, "today.request.sourceIds", 64), r.sourceIds.forEach((e) => fv(e, "today.request.sourceIds")), mv(r.sourceIds, "today.request.sourceIds")), pv(n.selections, "today.selections", 3);
	let i = t === "dashboard" ? iv : av;
	return mv(n.selections.map((e) => {
		let t = lv(e, "today.selection", ["operation", "figureKey"]);
		return (typeof t.operation != "string" || !i.includes(t.operation)) && Q("today.selection.operation"), dv(t.figureKey, "today.selection.figureKey"), t.figureKey.length > 64 && Q("today.selection.figureKey"), {
			operation: t.operation,
			figureKey: t.figureKey
		};
	}).map((e) => `${e.operation}:${e.figureKey}`), "today.selections"), sv(structuredClone(e));
}
function vv(e) {
	cv(e, "dashboard");
	let t = lv(e, "dashboard", [
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
	]), n = lv(t.workspace, "dashboard.workspace", [
		"id",
		"name",
		"currency",
		"demo",
		"createdAt"
	]);
	dv(n.id, "dashboard.workspace.id"), uv(n.name, "dashboard.workspace.name"), sh(n.createdAt, "dashboard.workspace.createdAt"), (typeof n.demo != "boolean" || typeof n.currency != "string" || !/^[A-Z]{3}$/.test(n.currency)) && Q("dashboard.workspace");
	for (let e of ["factCount", "sources"]) (typeof t[e] != "number" || !Number.isSafeInteger(t[e]) || t[e] < 0) && Q(`dashboard.${e}`);
	for (let e of [
		"decisions",
		"waitingActions",
		"jobs"
	]) pv(t[e], `dashboard.${e}`, 1e4);
	pv(t.lastActivity, "dashboard.lastActivity", 8), (!t.policy || typeof t.policy != "object" || Array.isArray(t.policy) || t.dictionary !== null && (!t.dictionary || typeof t.dictionary != "object" || Array.isArray(t.dictionary))) && Q("dashboard.metadata"), pv(t.calculations, "dashboard.calculations", 4), t.calculations.length !== 4 && Q("dashboard.calculations");
	let r = [], i = [], a = [];
	for (let e of t.calculations) {
		(!e || typeof e != "object" || Array.isArray(e)) && Q("dashboard.calculations");
		let t = e.operation;
		(typeof t != "string" || !iv.includes(t)) && Q("dashboard.calculations.operation"), a.push(t), Object.hasOwn(e, "error") ? (uv(lv(e, "dashboard.calculation.error", ["operation", "error"]).error, "dashboard.calculation.error"), i.push(t)) : r.push(Oh(e));
	}
	return mv(a, "dashboard.calculations.operation"), mv(r.map((e) => e.id), "dashboard.receipts"), sv({
		receipts: r,
		unavailableOperations: i
	});
}
function yv(e) {
	cv(e, "brief");
	let t = lv(e, "brief", [
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
	dv(t.id, "brief.id"), oh(t.onDate, "brief.onDate"), uv(t.headline, "brief.headline"), t.ritual !== "monday" && t.ritual !== "friday" && Q("brief.ritual"), pv(t.decisions, "brief.decisions", 1e4);
	let n = lv(t.compliance, "brief.compliance", [
		"entries",
		"calendarVersion",
		"status"
	]);
	pv(n.entries, "brief.compliance.entries", 1e4), n.calendarVersion !== null && uv(n.calendarVersion, "brief.compliance.calendarVersion"), uv(n.status, "brief.compliance.status");
	let r = lv(t.delivery, "brief.delivery", [
		"state",
		"channels",
		"requiresApproval"
	]);
	(r.state !== "draft" || r.requiresApproval !== !0 || !gv(r.channels, ["email", "whatsapp"])) && Q("brief.delivery");
	let i = lv(t.report, "brief.report", [
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
	dv(i.id, "brief.report.id"), uv(i.title, "brief.report.title"), sh(i.createdAt, "brief.report.createdAt"), (i.type !== "investor" || i.status !== "partial" && i.status !== "review-ready" || i.delivery !== "local-draft") && Q("brief.report"), typeof i.html != "string" && Q("brief.report.html"), pv(i.gaps, "brief.report.gaps", 1e3), i.gaps.forEach((e) => uv(e, "brief.report.gaps", 1e5)), pv(i.rowIds, "brief.report.rowIds", 1e4), i.rowIds.forEach((e) => dv(e, "brief.report.rowIds")), mv(i.rowIds, "brief.report.rowIds"), pv(i.sections, "brief.report.sections", 5);
	let a = i.sections.map((e) => {
		let t = lv(e, "brief.section", [
			"title",
			"receiptId",
			"figures",
			"period",
			"asOf",
			"dictionaryHash",
			"coverage",
			"explanation"
		]);
		return (typeof t.title != "string" || !av.includes(t.title)) && Q("brief.section.title"), dv(t.receiptId, "brief.section.receiptId"), uv(t.dictionaryHash, "brief.section.dictionaryHash"), uv(t.explanation, "brief.section.explanation", 1e5), t.period !== null && hv(t.period, "brief.section.period"), sh(t.asOf, "brief.section.asOf"), pv(t.figures, "brief.section.figures", 120), {
			operation: t.title,
			receiptId: t.receiptId,
			shared: t
		};
	}), o = a.map((e) => e.receiptId);
	return mv(o, "brief.sections"), mv(a.map((e) => e.operation), "brief.sections.operation"), (!gv(i.receiptIds, o) || !gv(t.receiptIds, o)) && Q("brief.receiptIds"), sv({
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
function bv(e, t) {
	(!gv(e.period, t.period ?? null) || e.branch !== (t.branch ?? null)) && Q("today.receipt.scope"), gv(e.requestedSourceIds, t.sourceIds) || Q("today.receipt.requestedSourceIds"), t.asOf !== void 0 && e.asOf !== new Date(t.asOf).toISOString() && Q("today.receipt.asOf");
}
function xv(e, t) {
	cv(e, "today.receipts"), pv(e, "today.receipts", 5);
	let n = e.map(Dh);
	return mv(n.map((e) => e.id), "today.receipts"), (n.length !== t.length || t.some((e) => !n.some((t) => t.id === e))) && Q("today.receipts.identity"), t.map((e) => n.find((t) => t.id === e));
}
function Sv(e, t, n, r) {
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
			let t = L_(n, e.figureKey), o = `${e.operation}:${e.figureKey}`;
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
			if (!(t instanceof I_)) throw t;
			o.push({
				...e,
				reasonCode: "UNSUPPORTED_PRESENTATION_CURRENCY"
			});
		}
	}
	return sv({
		source: e,
		today: Eh({
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
		unavailable: ov,
		...r ? { brief: r } : {}
	});
}
function Cv(e, t, n) {
	let r = _v(n, "dashboard"), i = vv(e), a = xv(t, i.receipts.map((e) => e.id));
	for (let e of a) {
		bv(e, r.request);
		let t = i.receipts.find((t) => t.id === e.id);
		for (let n of [...Sh, "requestedSourceIds"]) n !== "stale" && !gv(t[n], e[n]) && Q("dashboard.receipt.binding");
	}
	return Sv("dashboard", a, r);
}
function wv(e, t, n) {
	let r = _v(n, "brief"), i = yv(e), a = xv(t, i.sections.map((e) => e.receiptId));
	r.request.onDate !== void 0 && i.evidence.onDate !== r.request.onDate && Q("brief.onDate"), i.evidence.ritual !== (r.request.ritual ?? "monday") && Q("brief.ritual");
	for (let e of a) {
		bv(e, r.request);
		let t = i.sections.find((t) => t.receiptId === e.id);
		t.operation !== e.operation && Q("brief.receipt.operation");
		for (let n of [
			"figures",
			"period",
			"asOf",
			"dictionaryHash",
			"coverage",
			"explanation"
		]) gv(t.shared[n], e[n]) || Q("brief.receipt.binding");
	}
	let o = a.flatMap((e) => e.coverage.gaps), s = i.rawGaps.filter((e) => o.includes(e) || e === "This is an investor data annex. It does not provide a valuation or certify unimported metrics.");
	return Sv("brief", a, r, {
		...i.evidence,
		report: {
			...i.evidence.report,
			gaps: s
		}
	});
}
function Tv(e) {
	throw Object.freeze({ code: e });
}
function Ev(e, t, n, r) {
	let i = Symbol(), a = () => {
		i = Symbol(), r.invalidate();
	}, o = async (e) => {
		let t = [];
		for (let n of e) {
			let e = await r.receipt(n);
			e.ok || Tv(e.code), t.push(e.value);
		}
		return t;
	};
	return Object.freeze({
		environment: e,
		invalidate: a,
		dashboard(e) {
			let n = i, r;
			return P_(async () => (r = _v(e, "dashboard"), t(r.request)), async (e) => {
				let t = vv(e);
				return Cv(e, await o(t.receipts.map((e) => e.id)), r);
			}, () => i === n, a);
		},
		brief(e) {
			let t = i, r;
			return P_(async () => (r = _v(e, "brief"), n(r.request)), async (e) => {
				let t = yv(e);
				return wv(e, await o(t.sections.map((e) => e.receiptId)), r);
			}, () => i === t, a);
		}
	});
}
function Dv(e) {
	return Ev("desktop", (t) => e.request("dashboard.get", t), (t) => e.request("reports.brief", t), F_(e));
}
function Ov(e, t) {
	cv(e, "today.host");
	let n = lv(e, "today.host", [
		"source",
		"today",
		"receipts",
		"statsEvidence",
		"unavailableSelections",
		"unavailable"
	], ["brief"]);
	n.source !== "dashboard" && n.source !== "brief" && Q("today.host.source");
	let r = Eh(n.today);
	(r.pendingCount !== null || r.attention.length || r.worthLook.length || r.dayEvents.length || r.state.kind !== "partial" || r.state.asOf !== null || r.state.reasonCode !== "TODAY_ENGINE_CONTRACT_PARTIAL") && Q("today.host.contract"), gv(n.unavailable, ov) || Q("today.host.unavailable"), pv(n.receipts, "today.host.receipts", 5);
	let i = n.receipts.map(Dh);
	mv(i.map((e) => e.id), "today.host.receipts"), pv(n.statsEvidence, "today.host.statsEvidence", 3), pv(n.unavailableSelections, "today.host.unavailableSelections", 3);
	let a = n.statsEvidence.map((e) => {
		let t = lv(e, "today.host.stat", [
			"statId",
			"operation",
			"figureKey",
			"receiptId",
			"engineFigure",
			"scope",
			"coverage"
		]);
		return uv(t.operation, "today.host.stat.operation"), dv(t.figureKey, "today.host.stat.figureKey"), {
			operation: t.operation,
			figureKey: t.figureKey
		};
	}), o = n.unavailableSelections.map((e) => {
		let t = lv(e, "today.host.unavailableSelection", [
			"operation",
			"figureKey",
			"reasonCode"
		]);
		return uv(t.operation, "today.host.unavailableSelection.operation"), dv(t.figureKey, "today.host.unavailableSelection.figureKey"), (typeof t.reasonCode != "string" || ![
			"CALCULATION_UNAVAILABLE",
			"FIGURE_NOT_PROVIDED",
			"UNSUPPORTED_PRESENTATION_CURRENCY"
		].includes(t.reasonCode)) && Q("today.host.unavailableSelection.reasonCode"), {
			operation: t.operation,
			figureKey: t.figureKey
		};
	}), s = {
		title: r.title,
		date: r.date,
		request: {},
		selections: [...a, ...o]
	}, c = n.source === "dashboard" ? _v(s, "dashboard") : _v(s, "brief"), l = Sv(n.source, i, c);
	if ((!gv(l.today, r) || !gv(l.statsEvidence, n.statsEvidence) || !gv(l.unavailableSelections, n.unavailableSelections)) && Q("today.host.binding"), n.source === "brief" !== Object.hasOwn(n, "brief") && Q("today.host.brief"), Object.hasOwn(n, "brief")) {
		let e = lv(n.brief, "today.host.brief", [
			"id",
			"ritual",
			"onDate",
			"headline",
			"report",
			"delivery"
		]);
		dv(e.id, "today.host.brief.id"), oh(e.onDate, "today.host.brief.onDate"), uv(e.headline, "today.host.brief.headline"), e.ritual !== "monday" && e.ritual !== "friday" && Q("today.host.brief.ritual");
		let t = lv(e.report, "today.host.brief.report", [
			"id",
			"title",
			"type",
			"createdAt",
			"status",
			"gaps",
			"delivery"
		]);
		dv(t.id, "today.host.brief.report.id"), uv(t.title, "today.host.brief.report.title"), sh(t.createdAt, "today.host.brief.report.createdAt"), (t.type !== "investor" || t.status !== "partial" && t.status !== "review-ready" || t.delivery !== "local-draft") && Q("today.host.brief.report"), pv(t.gaps, "today.host.brief.report.gaps", 1e3), t.gaps.forEach((e) => uv(e, "today.host.brief.report.gaps", 1e5));
		let r = i.flatMap((e) => e.coverage.gaps);
		t.gaps.some((e) => typeof e != "string" || !r.includes(e) && e !== "This is an investor data annex. It does not provide a valuation or certify unimported metrics.") && Q("today.host.brief.report.gaps"), gv(e.delivery, {
			state: "draft",
			channels: ["email", "whatsapp"],
			requiresApproval: !0
		}) || Q("today.host.brief.delivery");
	}
	let u = rv(r, t);
	return sv({
		...u,
		data: {
			...u.data,
			earlierTodayMissing: "unknown"
		},
		source: e.source,
		statsEvidence: structuredClone(e.statsEvidence),
		unavailable: ov,
		...e.brief ? { brief: structuredClone(e.brief) } : {}
	});
}
//#endregion
//#region app/ui/src/host/text.ts
var kv = {
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
}, Av = {
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
	return (e === "hi" ? Av[t] : kv[t]).replace(/\{([A-Za-z]+)\}/g, (e, t) => n[t] ?? e);
}
function jv(e) {
	let t = e === "hi" ? jn : An;
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
var Mv = Object.freeze({ ok: !0 }), Nv = (e) => Object.freeze({
	ok: !1,
	code: e
});
function Pv(e) {
	if (typeof e == "object" && e) {
		for (let t of Object.values(e)) Pv(t);
		Object.freeze(e);
	}
}
function Fv(e, t) {
	if (e === t) return !0;
	if (e === null || t === null || typeof e != "object" || typeof t != "object") return !1;
	if (Array.isArray(e)) return Array.isArray(t) && e.length === t.length && e.every((e, n) => Fv(e, t[n]));
	if (Array.isArray(t)) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => Fv(Object.getOwnPropertyDescriptor(e, n)?.value, Object.getOwnPropertyDescriptor(t, n)?.value));
}
function Iv(e) {
	if (e instanceof Ym) return "INVALID_REPLY";
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
function Lv(e) {
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
function Rv(e, t = {}) {
	let n = Symbol(), r = Object.freeze({ kind: "idle" }), i = null, a = null, o = /* @__PURE__ */ new Set(), s = t.now ?? Date.now, c = (e) => {
		Pv(e), r = e;
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
		if (!u(e)) return Nv("READ_INVALIDATED");
		let r = Iv(t);
		return u(e) ? (n = Symbol(), a = null, i = null, c({
			kind: "unavailable",
			code: r
		}), Nv(r)) : Nv("READ_INVALIDATED");
	}, f = () => Nv("READ_INVALIDATED"), p = async (t, n, r) => {
		if (!u(n)) return f();
		let a = "id" in t ? t.id : t.modelReceiptId;
		if (c({
			kind: "busy",
			operation: "readback"
		}), !u(n)) return f();
		let o = await e.request("conversation.get", ng(a));
		if (!u(n)) return f();
		let s = zg(o, a);
		if (s.question !== r) throw new Ym("conversation.readback.question");
		if (!Fv(s.answer, t)) throw new Ym("conversation.readback.answer");
		return u(n) ? (i = null, c({
			kind: "answer",
			saved: s
		}), u(n) ? Mv : f()) : f();
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
				let o = rg(t);
				if (o.continuationId !== void 0) throw new Ym("conversation.request.continuationId");
				let s = rg(n ? {
					...o,
					continuationId: n.turnId
				} : o);
				if (Pv(s), !u(r)) return f();
				let l = await e.request("models.preview", s);
				if (!u(r)) return f();
				let d = await Tg(l, s);
				if (!u(r)) return f();
				if (d.purpose !== "conversation") throw new Ym("conversation.preview.purpose");
				return i = d.continuation ?? null, a = {
					stage: "planning",
					request: s,
					preview: d
				}, c({
					kind: "review",
					...a
				}), u(r) ? Mv : f();
			} catch (e) {
				return d(r, e);
			}
		},
		async open(t) {
			let n = l("readback");
			try {
				if (!u(n)) return f();
				let r = await e.request("conversation.get", ng(t));
				if (!u(n)) return f();
				let i = zg(r, t);
				return u(n) ? (c({
					kind: "answer",
					saved: i
				}), u(n) ? Mv : f()) : f();
			} catch (e) {
				return d(n, e);
			}
		},
		async selectContinuation(t) {
			let n = l("continuation");
			try {
				if (!u(n)) return f();
				let r = await e.request("conversation.continuation", ng(t));
				if (!u(n)) return f();
				let a = await sg(r, t);
				return u(n) ? (i = a, c({
					kind: "continuation",
					value: a
				}), u(n) ? Mv : f()) : f();
			} catch (e) {
				return d(n, e);
			}
		},
		async previewFinalWriting() {
			if (r.kind !== "answer" || r.saved.kind !== "grounded-conversation") return Nv("NO_TOOL_TURN");
			let t = r.saved.id, n = l("synthesis-preview");
			try {
				if (!u(n)) return f();
				let r = await e.request("conversation.synthesis.preview", Ag(t));
				if (!u(n)) return f();
				let i = await Tg(r, { id: t });
				if (!u(n)) return f();
				if (i.purpose !== "conversation-synthesis") throw new Ym("conversation.synthesis.preview.purpose");
				return a = {
					stage: "final-writing",
					toolTurnId: t,
					preview: i
				}, c({
					kind: "review",
					...a
				}), u(n) ? Mv : f();
			} catch (e) {
				return d(n, e);
			}
		},
		async sendReviewed(t) {
			let o = n, m = a, h;
			try {
				h = Lv(t);
			} catch {
				return Nv("CONSENT_REQUIRED");
			}
			if (!u(o) || a !== m) return f();
			if (!h || h.consent !== !0) return Nv("CONSENT_REQUIRED");
			if (r.kind !== "review" || !m || h.previewId !== m.preview.id || h.digest !== m.preview.digest) return Nv("REVIEW_CHANGED");
			let g = l("approval", !0);
			try {
				if (!u(g)) return f();
				let t = await e.request("models.approve", Og(m.preview));
				if (!u(g)) return f();
				let r = Eg(t, m.preview), o = s();
				if (!u(g)) return f();
				if (!Number.isFinite(o) || Date.parse(r.expiresAt) <= o) return n = Symbol(), a = null, i = null, c({
					kind: "unavailable",
					code: "APPROVAL_EXPIRED"
				}), Nv("APPROVAL_EXPIRED");
				let l;
				if (m.stage === "planning") {
					if (c({
						kind: "busy",
						operation: "ask"
					}), !u(g)) return f();
					l = await e.request("conversation.ask", kg(m.request, m.preview, r));
				} else {
					if (c({
						kind: "busy",
						operation: "synthesis-run"
					}), !u(g)) return f();
					l = await e.request("conversation.synthesis.run", jg(m.toolTurnId, m.preview, r));
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
				}, h = await Rg(l, d);
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
function zv(e) {
	throw new Ym(e);
}
function Bv(e, t) {
	(typeof e != "object" || !e || Array.isArray(e) || Object.getPrototypeOf(e) !== Object.prototype || Object.getOwnPropertySymbols(e).length) && zv(t);
	for (let n of Object.values(Object.getOwnPropertyDescriptors(e))) (!n.enumerable || !Object.hasOwn(n, "value") || n.value === void 0) && zv(t);
	return e;
}
function Vv(e, t, n) {
	let r = Bv(e, n);
	return (Object.keys(r).length !== t.length || t.some((e) => !Object.hasOwn(r, e))) && zv(n), r;
}
function Hv(e, t, n = 200) {
	return (typeof e != "string" || !e.trim() || e.length > n || /[\u0000-\u001f]/.test(e)) && zv(t), e;
}
function Uv(e, t) {
	let n = Hv(e, t);
	return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(n) || zv(t), n;
}
function Wv(e, t, n) {
	(!Array.isArray(e) || Object.getPrototypeOf(e) !== Array.prototype || e.length > n || Object.getOwnPropertySymbols(e).length) && zv(t);
	let r = Object.getOwnPropertyDescriptors(e);
	Object.keys(r).length !== e.length + 1 && zv(t);
	for (let n = 0; n < e.length; n++) (!r[String(n)]?.enumerable || !Object.hasOwn(r[String(n)], "value")) && zv(t);
	return e;
}
function Gv(e) {
	let t = Vv(e, [
		"workspace",
		"member",
		"contextKey"
	], "ui.context"), n = Vv(t.workspace, [
		"id",
		"name",
		"demo"
	], "ui.context.workspace"), r = Vv(t.member, [
		"id",
		"name",
		"role",
		"epoch",
		"branches"
	], "ui.context.member");
	typeof n.demo != "boolean" && zv("ui.context.workspace.demo"), (typeof r.role != "string" || ![
		"owner",
		"cofounder",
		"accountant",
		"viewer"
	].includes(r.role)) && zv("ui.context.member.role"), (!Number.isSafeInteger(r.epoch) || r.epoch < 1) && zv("ui.context.member.epoch");
	let i = Wv(r.branches, "ui.context.member.branches", 1e3).map((e, t) => Hv(e, `ui.context.member.branches[${t}]`));
	return new Set(i).size !== i.length && zv("ui.context.member.branches"), (typeof t.contextKey != "string" || !/^[a-f0-9]{64}$/.test(t.contextKey)) && zv("ui.context.contextKey"), Object.freeze({
		workspace: Object.freeze({
			id: Uv(n.id, "ui.context.workspace.id"),
			name: Hv(n.name, "ui.context.workspace.name", 100),
			demo: n.demo
		}),
		member: Object.freeze({
			id: Uv(r.id, "ui.context.member.id"),
			name: Hv(r.name, "ui.context.member.name", 200),
			role: r.role,
			epoch: r.epoch,
			branches: Object.freeze(i)
		}),
		contextKey: t.contextKey
	});
}
function Kv(e) {
	let t = Wv(e, "models.list", 100).map((e, t) => {
		let n = `models.list[${t}]`, r = Bv(e, n);
		(typeof r.enabled != "boolean" || r.installationVerified !== !1) && zv(n);
		let i = Hv(r.kind, `${n}.kind`);
		[
			"codex-cli",
			"claude-cli",
			"openai-responses",
			"openai-compatible",
			"ollama",
			"managed"
		].includes(i) || zv(`${n}.kind`);
		let a = Hv(r.model, `${n}.model`, 128);
		return Object.freeze({
			id: Uv(r.id, `${n}.id`),
			label: Object.hasOwn(r, "label") ? Hv(r.label, `${n}.label`, 200) : a,
			kind: i,
			model: a,
			enabled: r.enabled,
			installationVerified: !1
		});
	});
	return new Set(t.map((e) => e.id)).size !== t.length && zv("models.list"), Object.freeze(t);
}
//#endregion
//#region app/ui/src/host/controller.ts
function qv(e) {
	return Object.assign(Error(e), { code: e });
}
function Jv(e, t) {
	if (!Number.isFinite(e)) throw qv("INVALID_REPLY");
	let n = new Intl.DateTimeFormat("en-CA", {
		timeZone: t,
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	}).formatToParts(e), r = (e) => n.find((t) => t.type === e)?.value, i = r("year"), a = r("month"), o = r("day");
	if (!i || !a || !o || !/^\d{4}$/.test(i) || !/^\d{2}$/.test(a) || !/^\d{2}$/.test(o)) throw qv("INVALID_REPLY");
	let s = String(new Date(Date.UTC(Number(i), Number(a), 0)).getUTCDate()).padStart(2, "0");
	return Object.freeze({
		date: `${i}-${a}-${o}`,
		period: Object.freeze({
			from: `${i}-${a}-01`,
			to: `${i}-${a}-${s}`
		})
	});
}
var Yv = (e, t) => Object.freeze({
	phase: e,
	...t === void 0 ? {} : { code: t },
	context: null,
	today: null,
	routes: Object.freeze([]),
	selectedRouteId: null,
	receipt: null
});
function Xv(e, t = {}) {
	let n = t.now ?? Date.now, r = t.timeZone ?? "UTC";
	new Intl.DateTimeFormat("en", { timeZone: r });
	let i = Yv("loading"), a = Symbol(), o = Symbol(), s = !1, c = null, l = null, u = /* @__PURE__ */ new Set();
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
		return Gv(await e.request("ui.context", {}));
	}
	function m(e, t) {
		if (e.contextKey !== t.contextKey || e.workspace.id !== t.workspace.id || e.member.id !== t.member.id || e.member.epoch !== t.member.epoch || e.member.role !== t.member.role) throw x("ACCESS_DENIED"), qv("ACCESS_DENIED");
	}
	async function h(t, n) {
		let r = a, o = i.context;
		if (!f(r) || o === null || i.phase !== "ready") throw qv("ACCESS_DENIED");
		try {
			let i = await p();
			if (!f(r)) throw qv("READ_INVALIDATED");
			if (m(i, o), t === "models.preview" || t === "conversation.ask") {
				let e = Object.getOwnPropertyDescriptor(n, "routeId");
				if (l === null || e?.value !== l.routeId) throw qv("ACCESS_DENIED");
			}
			let a = await e.request(t, n);
			if (!f(r)) throw qv("READ_INVALIDATED");
			let s = await p();
			if (!f(r)) throw qv("READ_INVALIDATED");
			return m(s, o), a;
		} catch (e) {
			let t = N_(e);
			throw f(r) && (M_(t) || t === "INVALID_REPLY") && x(t), e;
		}
	}
	let g = { request: h }, _ = Dv(g), v = F_(g), y = Rv(g, { now: n });
	function b() {
		a = Symbol(), o = Symbol(), l = null, _.invalidate(), v.invalidate(), y.invalidate();
	}
	function x(e = "READ_INVALIDATED") {
		b(), y.invalidate(e), d(Yv(e === "VAULT_LOCKED" ? "locked" : "unavailable", e));
	}
	async function S() {
		if (s || i.phase === "locked") return;
		b(), d(Yv("loading"));
		let e = a;
		try {
			let t = await p();
			if (!f(e)) return;
			d({
				...Yv("ready"),
				context: t
			});
			let a = Jv(n(), r), o = {
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
			}, s = await _.dashboard(o);
			if (!f(e)) return;
			if (!s.ok) {
				x(s.code);
				return;
			}
			let c = Kv(await h("models.list", {}));
			if (!f(e)) return;
			d({
				...i,
				today: s.value,
				routes: c
			});
		} catch (t) {
			f(e) && x(N_(t));
		}
	}
	function C() {
		if (c !== null) return c;
		let e = a, t = i.context;
		return !f(e) || i.phase !== "ready" || t === null ? Promise.resolve() : (c = (async () => {
			try {
				let n = await p();
				f(e) && m(n, t);
			} catch (t) {
				f(e) && x(N_(t));
			} finally {
				c = null;
			}
		})(), c);
	}
	function w(e) {
		if (s || i.phase !== "ready" || i.context === null) return;
		let t = e === null ? null : i.routes.find((t) => t.id === e && t.enabled);
		if (e !== null && t === void 0) {
			x("INVALID_REPLY");
			return;
		}
		b(), l = t == null || i.context.member.role === "viewer" ? null : Object.freeze({
			purpose: "conversation",
			questionDisclosure: "verbatim",
			routeId: t.id
		}), d({
			...i,
			selectedRouteId: l?.routeId ?? null,
			receipt: null
		});
	}
	async function T(e, t) {
		if (s || i.context === null || i.phase !== "ready") return;
		let n;
		try {
			if (n = Object.freeze(Vn(Hn(t))), n.sheet === void 0 || !Un(n, t)) throw qv("INVALID_REPLY");
		} catch {
			x("INVALID_REPLY");
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
		let l = await v.receipt(e);
		if (f(r) && o === c) {
			if (!l.ok) {
				M_(l.code) || l.code === "INVALID_REPLY" ? x(l.code) : d({
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
	function ee() {
		o = Symbol(), s || d({
			...i,
			receipt: null
		});
	}
	async function E() {
		if (s) return;
		let t = i.context?.member.role;
		if (x("VAULT_LOCKED"), t === "owner" || t === "cofounder") try {
			await e.request("workspace.lock", {});
		} catch (e) {
			s || x(N_(e));
		}
	}
	return Object.freeze({
		conversation: y,
		timeZone: r,
		snapshot: () => i,
		subscribe(e) {
			return s ? () => {} : (u.add(e), () => {
				u.delete(e);
			});
		},
		refresh: S,
		checkAuthority: C,
		selectRoute: w,
		questionSettings: () => l,
		openReceipt: T,
		closeReceipt: ee,
		invalidate: x,
		lock: E,
		dispose() {
			s || (b(), d(Yv("unavailable", "READ_INVALIDATED")), s = !0, u.clear());
		}
	});
}
//#endregion
//#region app/ui/src/host/bootstrap.tsx
var Zv = {
	place: "today",
	sub: "today"
}, Qv = {
	place: "ask",
	sub: "new"
}, $v = {
	place: "trust",
	sub: "models"
}, ey = {
	owner: "roleOwner",
	cofounder: "roleCofounder",
	accountant: "roleAccountant",
	viewer: "roleViewer"
};
function ty(e) {
	window.location.hash = Hn(e);
}
function ny() {
	return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
function ry({ routes: e, selected: t, language: n, viewer: r, onSelect: i }) {
	let a = "host-route-label";
	return /* @__PURE__ */ (0, j.jsxs)("section", { children: [
		/* @__PURE__ */ (0, j.jsx)(zp, {
			where: $(n, "routeLabel"),
			title: $(n, "routesTitle")
		}),
		/* @__PURE__ */ (0, j.jsx)("p", {
			className: Y.note,
			children: $(n, "routesNote")
		}),
		/* @__PURE__ */ (0, j.jsx)("p", {
			className: Y.note,
			children: $(n, "routesUnverified")
		}),
		r ? /* @__PURE__ */ (0, j.jsx)("p", {
			role: "status",
			children: $(n, "viewerNoAsk")
		}) : e.length === 0 ? /* @__PURE__ */ (0, j.jsx)("p", {
			role: "status",
			children: $(n, "routesEmpty")
		}) : /* @__PURE__ */ (0, j.jsxs)("div", {
			className: Y.block,
			children: [
				/* @__PURE__ */ (0, j.jsx)("label", {
					id: a,
					htmlFor: "host-route",
					children: $(n, "routeLabel")
				}),
				/* @__PURE__ */ (0, j.jsxs)("select", {
					id: "host-route",
					"aria-labelledby": a,
					value: t ?? "",
					onChange: (e) => i(e.currentTarget.value || null),
					children: [/* @__PURE__ */ (0, j.jsx)("option", {
						value: "",
						children: $(n, "routePlaceholder")
					}), e.map((e) => /* @__PURE__ */ (0, j.jsx)("option", {
						value: e.id,
						disabled: !e.enabled,
						children: e.enabled ? $(n, "routeDescription", {
							label: e.label,
							kind: e.kind,
							model: e.model
						}) : $(n, "routeDisabled", { label: e.label })
					}, e.id))]
				}),
				t !== null && /* @__PURE__ */ (0, j.jsx)(Cr, {
					variant: "link",
					onClick: () => i(null),
					children: $(n, "routeClear")
				})
			]
		})
	] });
}
function iy({ value: e, language: t }) {
	let n = jv(t), r = (e) => $(t, e), i = (e) => e === null ? n["not-applicable"] : $(t, "dateRange", {
		from: e.from,
		to: e.to
	}), a = (e) => e.length === 0 ? r("none") : e.join(", "), o = e.coverage.completeness !== "empty" && (e.coverage.completeness !== "partial" || e.coverage.countedRows !== 0), s = (e) => /* @__PURE__ */ (0, j.jsx)("dl", {
		className: Y.pairs,
		children: e.map(([e, t]) => /* @__PURE__ */ (0, j.jsxs)("div", {
			className: Y.pair,
			children: [/* @__PURE__ */ (0, j.jsx)("dt", {
				className: Y.name,
				children: e
			}), /* @__PURE__ */ (0, j.jsx)("dd", {
				className: Y.value,
				children: t
			})]
		}, e))
	});
	return /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [
		/* @__PURE__ */ (0, j.jsx)("p", {
			className: Y.note,
			children: r("receiptSubset")
		}),
		/* @__PURE__ */ (0, j.jsx)("p", {
			className: Y.note,
			children: r(e.stale ? "stale" : "fresh")
		}),
		e.staleReason !== void 0 && /* @__PURE__ */ (0, j.jsx)("p", {
			className: Y.exact,
			children: e.staleReason
		}),
		!o && /* @__PURE__ */ (0, j.jsx)("p", {
			role: "status",
			children: r("receiptUnknown")
		}),
		/* @__PURE__ */ (0, j.jsxs)("section", {
			className: Y.block,
			children: [/* @__PURE__ */ (0, j.jsx)("h3", {
				className: Y.label,
				children: r("figures")
			}), o && e.figures.length > 0 ? e.figures.map((n) => /* @__PURE__ */ (0, j.jsxs)("div", {
				className: Y.block,
				children: [
					/* @__PURE__ */ (0, j.jsx)("p", {
						className: Y.exact,
						children: n.label
					}),
					/* @__PURE__ */ (0, j.jsx)("p", {
						className: Y.exact,
						children: n.display
					}),
					/* @__PURE__ */ (0, j.jsx)("p", {
						className: Y.note,
						children: n.unit === "basis-points" ? $(t, "exactPoints", { minor: n.minor }) : $(t, "exactMoney", {
							minor: n.minor,
							currency: n.currency ?? e.currency
						})
					})
				]
			}, n.key)) : /* @__PURE__ */ (0, j.jsx)("p", { children: n.unknown })]
		}),
		/* @__PURE__ */ (0, j.jsxs)("section", {
			className: Y.block,
			children: [/* @__PURE__ */ (0, j.jsx)("h3", {
				className: Y.label,
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
		/* @__PURE__ */ (0, j.jsxs)("section", {
			className: Y.block,
			children: [
				/* @__PURE__ */ (0, j.jsx)("h3", {
					className: Y.label,
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
				/* @__PURE__ */ (0, j.jsx)("h4", {
					className: Y.label,
					children: r("gaps")
				}),
				e.coverage.gaps.length > 0 ? /* @__PURE__ */ (0, j.jsx)("ul", { children: e.coverage.gaps.map((e, t) => /* @__PURE__ */ (0, j.jsx)("li", { children: e }, t)) }) : /* @__PURE__ */ (0, j.jsx)("p", { children: r("none") })
			]
		}),
		/* @__PURE__ */ (0, j.jsxs)("section", {
			className: Y.block,
			children: [/* @__PURE__ */ (0, j.jsx)("h3", {
				className: Y.label,
				children: r("explanation")
			}), /* @__PURE__ */ (0, j.jsx)("p", {
				className: Y.exact,
				children: e.explanation
			})]
		}),
		/* @__PURE__ */ (0, j.jsxs)("section", {
			className: Y.block,
			children: [/* @__PURE__ */ (0, j.jsx)("h3", {
				className: Y.label,
				children: r("hashes")
			}), s([
				[r("dictionaryHash"), e.dictionaryHash],
				[r("definitionHash"), e.definitionHash],
				[r("ontologyVersion"), String(e.ontologyVersion)]
			])]
		}),
		/* @__PURE__ */ (0, j.jsxs)("details", { children: [/* @__PURE__ */ (0, j.jsx)("summary", { children: r("ledger") }), /* @__PURE__ */ (0, j.jsx)("pre", {
			className: Y.payload,
			children: JSON.stringify({
				rowIds: e.rowIds,
				rows: e.rows,
				exclusions: e.exclusions
			}, null, 2)
		})] }),
		/* @__PURE__ */ (0, j.jsxs)("details", { children: [/* @__PURE__ */ (0, j.jsx)("summary", { children: r("assumptions") }), /* @__PURE__ */ (0, j.jsx)("pre", {
			className: Y.payload,
			children: JSON.stringify(e.assumptions, null, 2)
		})] }),
		/* @__PURE__ */ (0, j.jsxs)("details", { children: [
			/* @__PURE__ */ (0, j.jsx)("summary", { children: r("exactFields") }),
			!o && /* @__PURE__ */ (0, j.jsx)("p", { children: r("receiptUnknown") }),
			/* @__PURE__ */ (0, j.jsx)("pre", {
				className: Y.payload,
				children: JSON.stringify(e, null, 2)
			})
		] })
	] });
}
function ay({ selection: e, language: t, origin: n, onClose: r }) {
	return /* @__PURE__ */ (0, j.jsxs)(yp, {
		kind: $(t, "receipt"),
		title: e.id,
		origin: n,
		onClose: r,
		children: [e.kind === "ready" ? /* @__PURE__ */ (0, j.jsx)(iy, {
			value: e.value,
			language: t
		}) : /* @__PURE__ */ (0, j.jsx)("p", {
			role: "status",
			children: $(t, e.kind === "loading" ? "receiptLoading" : "receiptFailed")
		}), e.kind === "failed" && /* @__PURE__ */ (0, j.jsx)("p", { children: $(t, "code", { code: e.code }) })]
	});
}
function oy({ language: e }) {
	return /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [
		/* @__PURE__ */ (0, j.jsx)("dl", {
			className: Y.pairs,
			children: [
				["Ctrl K", "helpAsk"],
				["Ctrl 1–7", "helpPlaces"],
				["Esc", "helpClose"],
				["F6 / Shift F6", "helpRegions"],
				["Ctrl /", "helpList"]
			].map(([t, n]) => /* @__PURE__ */ (0, j.jsxs)("div", {
				className: Y.pair,
				children: [/* @__PURE__ */ (0, j.jsx)("dt", {
					className: Y.name,
					children: t
				}), /* @__PURE__ */ (0, j.jsx)("dd", {
					className: Y.value,
					children: $(e, n)
				})]
			}, t))
		}),
		/* @__PURE__ */ (0, j.jsx)("p", { children: $(e, "helpSendGuard") }),
		/* @__PURE__ */ (0, j.jsx)("p", { children: $(e, "helpUnavailable") })
	] });
}
function sy({ controller: e, state: t, context: n, language: r, view: i, setLanguage: a, setView: o, onLegacyReturn: s }) {
	let c = JSON.stringify([n.contextKey, t.selectedRouteId]), l = (0, _.useRef)(Zv), u = (0, _.useRef)(null), d = (0, _.useRef)(null), f = (0, _.useRef)(null), p = (0, _.useRef)(0), [m, h] = (0, _.useState)(void 0), [g, v] = (0, _.useState)(null), y = (0, _.useRef)(g);
	y.current = g;
	let b = n.member.role === "viewer", x = t.routes.find((e) => e.id === t.selectedRouteId && e.enabled), S = e.questionSettings(), C = !b && x !== void 0 && S !== null && S.routeId === x.id, w = (0, _.useMemo)(() => {
		if (t.today === null) return { kind: "missing" };
		try {
			return {
				kind: "ready",
				value: Ov(t.today, {
					language: r,
					timeZone: e.timeZone,
					missingWords: jv(r)
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
		w.kind === "invalid" && e.invalidate("INVALID_REPLY");
	}, [w.kind, e]);
	let T = (0, _.useCallback)((t) => {
		l.current = t;
		let n = e.snapshot().receipt;
		n !== null && (t === null || !Un(n.address, t)) && e.closeReceipt();
		let r = y.current;
		r !== null && (t === null || !Un(r.address, t)) && v(null);
	}, [e]), ee = () => {
		let r = e.snapshot();
		return r.phase === "ready" && r.context?.contextKey === n.contextKey && r.selectedRouteId === t.selectedRouteId;
	}, E = (e) => {
		if (!ee() || !C) return;
		let t = {
			place: "ask",
			sub: "saved"
		};
		p.current += 1, h({
			id: e,
			address: t,
			selectionKey: String(p.current)
		}), ty(t);
	}, te = () => {
		let t = y.current?.kind === "help" ? u.current?.isConnected ? u.current : d.current : null;
		e.closeReceipt(), y.current = null, v(null), t?.isConnected && t.focus();
		let n = f.current;
		f.current = null, n !== null && ee() ? E(n) : l.current !== null && ty(Wn(l.current));
	}, ne = (t, n = null) => {
		if (!ee() || l.current === null) return;
		u.current = ny(), f.current = n, v(null);
		let r = Gn(l.current, "receipt");
		ty(r), e.openReceipt(t, r);
	}, D = (t, n = null) => {
		if (!ee() || l.current === null) return;
		u.current = ny(), f.current = n, e.closeReceipt();
		let r = Gn(l.current, "reference");
		v({
			address: r,
			kind: "reference",
			id: t
		}), ty(r);
	}, re = (e, t) => {
		e.kind === "calculation-receipt" ? ne(e.id, t.id) : e.kind === "answer" ? E(e.id) : D(e.kind === "synthesis-receipt" ? e.receipt.id : e.id, t.id);
	}, ie = (t) => {
		ee() && (e.selectRoute(t), ty(t === null ? Zv : Qv));
	}, ae = () => {
		if (!ee() || l.current === null) return;
		u.current = ny(), f.current = null, e.closeReceipt();
		let t = Gn(l.current, "about");
		v({
			address: t,
			kind: "about"
		}), ty(t);
	}, oe = (t, n) => {
		if (!ee() || l.current === null || y.current?.kind === "help") return;
		let r = t === void 0 ? ny() : t, i = r?.closest("[data-region=\"sheet\"]") ? u.current : r;
		d.current = n?.isConnected ? n : null, u.current = i?.isConnected ? i : n?.isConnected ? n : null, f.current = null, e.closeReceipt();
		let a = Gn(l.current, "help"), o = {
			address: a,
			kind: "help"
		};
		y.current = o, v(o), ty(a);
	};
	if (w.kind === "invalid") return /* @__PURE__ */ (0, j.jsx)(Lp, { state: {
		kind: "failed",
		code: "INVALID_REPLY"
	} });
	let se = jv(r), ce = w.kind === "ready" ? w.value.data : {
		state: { kind: "loading" },
		date: "",
		review: {
			count: {
				exact: null,
				display: se["not-loaded-yet"]
			},
			rows: []
		},
		thisMonthMissing: "not-loaded-yet",
		earlierTodayMissing: "unknown"
	}, le = t.receipt === null ? g === null ? void 0 : {
		address: g.address,
		content: /* @__PURE__ */ (0, j.jsxs)(yp, {
			kind: $(r, g.kind === "help" ? "helpTitle" : g.kind === "about" ? "aboutTitle" : "reference"),
			title: $(r, g.kind === "help" ? "helpTitle" : g.kind === "about" ? "aboutTitle" : "reference"),
			origin: u.current,
			onClose: te,
			children: [
				g.kind === "help" ? /* @__PURE__ */ (0, j.jsx)(oy, { language: r }) : /* @__PURE__ */ (0, j.jsx)("p", { children: $(r, g.kind === "about" ? "about" : "referenceUnavailable") }),
				g.id !== void 0 && /* @__PURE__ */ (0, j.jsx)("p", {
					className: Y.exact,
					children: $(r, "referenceIdentity", { id: g.id })
				}),
				/* @__PURE__ */ (0, j.jsx)(Cr, {
					variant: "link",
					onClick: s,
					children: $(r, "legacy")
				})
			]
		})
	} : {
		address: t.receipt.address,
		content: /* @__PURE__ */ (0, j.jsx)(ay, {
			selection: t.receipt,
			language: r,
			origin: u.current,
			onClose: te
		}, t.receipt.id)
	}, ue = {
		shellKind: "desktop",
		view: i,
		language: r,
		menu: {
			workspace: {
				name: n.workspace.name,
				demo: n.workspace.demo,
				who: $(r, "memberRole", {
					name: n.member.name,
					role: $(r, ey[n.member.role])
				})
			},
			onSetView: o,
			onSetLanguage: a,
			onLock: () => {
				e.lock();
			},
			onAbout: ae
		},
		ask: {
			onAsk: () => ty(Qv),
			noModel: !C,
			...b ? { readOnly: { holder: $(r, "roleViewer") } } : {}
		},
		status: {
			sources: {
				text: $(r, w.kind === "ready" ? "sourcesReady" : "sourcesMissing"),
				address: {
					place: "books",
					sub: "sources"
				}
			},
			model: {
				text: x === void 0 ? $(r, "routeMissing") : $(r, "routeSelected", { label: x.label }),
				address: $v
			},
			third: { text: $(r, "third") }
		},
		statusSimple: [$(r, w.kind === "ready" ? "sourcesReady" : "sourcesMissing"), x === void 0 ? $(r, "routeMissing") : $(r, "routeSelected", { label: x.label })],
		capabilities: {},
		today: {
			data: ce,
			intents: {
				onReview: (e) => D(e),
				onReceipt: (e) => ne(e)
			}
		},
		sheet: le,
		onAddress: T,
		onHelp: oe,
		renderPlace: (e) => e.place === "trust" && e.sub === "models" || e.place === "ask" && (e.sub === void 0 || e.sub === "new") ? /* @__PURE__ */ (0, j.jsx)(ry, {
			routes: t.routes,
			selected: t.selectedRouteId,
			language: r,
			viewer: b,
			onSelect: ie
		}) : /* @__PURE__ */ (0, j.jsxs)(j.Fragment, { children: [/* @__PURE__ */ (0, j.jsx)(Lp, { state: { kind: "not-built" } }), /* @__PURE__ */ (0, j.jsx)(Cr, {
			variant: "link",
			onClick: s,
			children: $(r, "legacy")
		})] })
	};
	return C && S !== null ? /* @__PURE__ */ (0, j.jsx)(w_, {
		app: ue,
		conversation: e.conversation,
		questionSettings: S,
		contextKey: c,
		readback: m,
		onReference: re
	}) : /* @__PURE__ */ (0, j.jsx)(Jm, { ...ue }, c);
}
function cy({ controller: e, options: t, onLegacyReturn: n }) {
	let r = (0, _.useSyncExternalStore)(e.subscribe, e.snapshot, e.snapshot), [i, a] = (0, _.useState)(t.language ?? "en"), [o, s] = (0, _.useState)(t.view ?? "guided");
	(0, _.useEffect)(() => {
		e.refresh();
	}, [e]), (0, _.useEffect)(() => {
		document.documentElement.lang = i, document.documentElement.removeAttribute("data-theme");
	}, [i]);
	let c = r.phase === "ready" && r.context !== null;
	return /* @__PURE__ */ (0, j.jsx)(Pn, {
		language: i,
		children: /* @__PURE__ */ (0, j.jsxs)("div", {
			style: {
				height: "100vh",
				display: "grid",
				gridTemplateRows: "auto minmax(0, 1fr)"
			},
			children: [/* @__PURE__ */ (0, j.jsxs)("div", {
				style: {
					display: "flex",
					flexWrap: "wrap",
					gap: "var(--sp4)",
					padding: "var(--sp2) var(--sp4)",
					borderBottom: "var(--hair) solid var(--line)"
				},
				children: [/* @__PURE__ */ (0, j.jsx)(Cr, {
					variant: "link",
					onClick: n,
					children: $(i, "legacy")
				}), /* @__PURE__ */ (0, j.jsx)(Cr, {
					variant: "link",
					onClick: () => {
						e.refresh();
					},
					disabled: r.phase === "loading" || r.phase === "locked",
					children: $(i, "refresh")
				})]
			}), /* @__PURE__ */ (0, j.jsx)("div", {
				"data-host-workspace": "",
				style: {
					minHeight: 0,
					overflow: "auto"
				},
				children: c && r.context !== null ? /* @__PURE__ */ (0, j.jsx)(sy, {
					controller: e,
					state: r,
					context: r.context,
					language: i,
					view: o,
					setLanguage: a,
					setView: s,
					onLegacyReturn: n
				}, JSON.stringify([r.context.contextKey, r.selectedRouteId])) : /* @__PURE__ */ (0, j.jsxs)("div", {
					style: { padding: "var(--sp6)" },
					children: [/* @__PURE__ */ (0, j.jsx)("p", {
						role: "status",
						children: $(i, r.phase === "loading" ? "loading" : r.phase === "locked" ? "locked" : "unavailable")
					}), r.code !== void 0 && /* @__PURE__ */ (0, j.jsx)("p", { children: $(i, "code", { code: r.code }) })]
				})
			})]
		})
	});
}
function ly(e, t, n = {}) {
	ty(Zv), document.documentElement.removeAttribute("data-theme");
	let r = (0, v.createRoot)(e), i = !1, a = () => {
		i || (i = !0, t.dispose(), r.unmount());
	};
	return r.render(/* @__PURE__ */ (0, j.jsx)(cy, {
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
export { k_ as createDesktopRequestPort, Xv as createHostController, ly as mountHost };

//# sourceMappingURL=host.js.map