---
version: 1.0
updatedAt: 2026-09-26
title: "Ingress Controllers e a Gateway API"
summary: "Roteamento por host e path com Ingress, o que o add-on de ingress do MicroK8s instala hoje (Traefik), o fim de vida do ingress-nginx, e HTTPRoutes com a Gateway API."
---
## Objective

Um **Ingress** é um conjunto de regras de roteamento HTTP (host e path para Service) que um **Ingress controller** implementa, normalmente nas portas 80 e 443 do nó. Ele permite que muitos serviços compartilhem um IP com hostnames como `api.example.com` e `grafana.example.com`, e termina o TLS num único lugar. O cenário mudou em 2026: o controller comunitário `ingress-nginx` chegou ao fim de vida em março de 2026, o MicroK8s trocou o seu add-on de ingress baseado em NGINX pelo **Traefik**, e a **Gateway API** é a sucessora do recurso Ingress. Este conceito cobre o recurso Ingress, o que o add-on do MicroK8s entrega hoje, o roteamento de várias aplicações por host, e quando escrever rotas da Gateway API no lugar.

## Use Cases

- Expor uma API, dashboards e ferramentas de administração num nó com hostnames diferentes.
- Terminar o TLS de todos eles com uma única estratégia de certificados (cert-manager).
- Ler um guia antigo que diz "habilite o ingress e você ganha NGINX" e entender o que realmente roda agora.
- Planejar a migração de annotations específicas do NGINX.

## Deep Dive

### O que `microk8s enable ingress` instala hoje

Verificado no MicroK8s `1.35/stable` (v1.35.6, setembro de 2026), que já traz a mudança anunciada com a 1.36:

```
$ microk8s enable ingress
...
Gateway API is also available. Create HTTPRoute resources for modern routing.

$ kubectl -n ingress get ds
NAME      DESIRED   CURRENT   READY
traefik   1         1         1

$ kubectl get ingressclass
NAME      CONTROLLER                      
nginx     traefik.io/ingress-controller
public    traefik.io/ingress-controller
traefik   traefik.io/ingress-controller
```

- O controller é o **Traefik v3** (imagem `traefik:v3.6.x`) como DaemonSet no namespace `ingress`, com `hostPort` 80 e 443 no nó.
- Três IngressClasses apontam para ele: `public` e `nginx` existem por compatibilidade com manifests escritos para o antigo add-on NGINX.
- O Traefik roda o seu provider `kubernetesIngressNGINX` para a classe `nginx`, que entende um subconjunto das annotations `nginx.ingress.kubernetes.io/*`. Verificado: um Ingress com classe `nginx` e `nginx.ingress.kubernetes.io/rewrite-target: /` roteou `/api` para o `/` do backend.
- Os CRDs da Gateway API são instalados, com uma `GatewayClass` `traefik` e um `Gateway` `traefik-gateway` pronto no namespace `ingress`, escutando HTTP.
- Sem uma Secret TLS, o HTTPS responde com `CN=TRAEFIK DEFAULT CERT`, um placeholder autoassinado. `--default-ssl-certificate NAMESPACE/NAME` no enable o substitui.

Revisões mais antigas do MicroK8s e muitos tutoriais instalam o `ingress-nginx`. Se você roda um desses, saiba que o `kubernetes/ingress-nginx` upstream parou de receber correções, inclusive de segurança, em 24 de março de 2026.

### Um Ingress com hosts e paths

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: web
  namespace: team-a
spec:
  ingressClassName: public
  tls:
    - hosts: [api.example.com]
      secretName: api-example-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: {name: api, port: {number: 80}}
```

- `ingressClassName` escolhe o controller. Omitir depende de uma classe padrão; seja explícito.
- `pathType: Prefix` casa por segmentos de path (`/api` casa com `/api` e `/api/x`, não com `/apix`); `Exact` casa um único path; `ImplementationSpecific` é definido pelo controller.
- Um Ingress só roteia para Services **do seu próprio namespace**. Services em `team-a`, `monitoring` e `tooling` precisam cada um de um Ingress no seu namespace (os hosts podem compartilhar o mesmo controller e IP).

Um layout típico de nó único, um Ingress por namespace:

| Host | Namespace | Service |
|---|---|---|
| `api.example.com` | `team-a` | `api:80` |
| `grafana.example.com` | `monitoring` | `grafana:80` |
| `admin.example.com` | `tooling` | `dashboard:8443` (backend HTTPS) |

Backends que falam HTTPS por conta própria (o dashboard na 8443) precisam que o controller use TLS até eles. No Traefik isso é um `ServersTransport` ou a annotation `traefik.ingress.kubernetes.io/service.serversscheme: https` no Service; no ingress-nginx era `nginx.ingress.kubernetes.io/backend-protocol: HTTPS`. Annotations específicas de controller são exatamente o que torna manifests de Ingress não portáveis.

Testando sem DNS:

```bash
curl -H 'Host: api.example.com' http://<ip-do-nó>/
curl -k --resolve api.example.com:443:<ip-do-nó> https://api.example.com/
```

### Gateway API: a sucessora

O Ingress só padronizou roteamento por host e path; todo o resto (rewrites, match por header, timeouts, TLS até o backend, divisão de tráfego) foi parar em annotations. A Gateway API separa as responsabilidades em recursos tipados:

- `GatewayClass`: qual controller (instalada pelo add-on).
- `Gateway`: listeners (portas, protocolos, TLS), de responsabilidade do time de plataforma.
- `HTTPRoute`: regras de roteamento, de responsabilidade de cada time de aplicação, anexadas a um Gateway, possivelmente de outro namespace.

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata: {name: api, namespace: team-a}
spec:
  parentRefs:
    - {name: traefik-gateway, namespace: ingress}
  hostnames: [api.example.com]
  rules:
    - matches: [{path: {type: PathPrefix, value: /}}]
      backendRefs: [{name: api, port: 80}]
```

Verificado no add-on do MicroK8s: essa rota ficou `Accepted` e `ResolvedRefs`, e `curl -H 'Host: gw.example.test' http://<ip-do-nó>/` chegou ao backend. Match por header, pesos para canários, redirects e rewrites de URL são campos do spec, não annotations, e funcionam igual entre implementações. A ferramenta `ingress2gateway` do SIG Network (1.0 lançada em março de 2026) converte Ingresses existentes, incluindo muitas annotations do NGINX.

### Qual escrever hoje

- **Serviços novos**: HTTPRoute, se o seu controller suporta Gateway API (Traefik, Envoy Gateway, Istio, Cilium e NGINX Gateway Fabric suportam).
- **Ingresses existentes**: continuam funcionando no Traefik. Planeje a migração, começando pelos que dependem de annotations do NGINX, já que a compatibilidade do Traefik cobre só um subconjunto.
- **Regras simples e portáveis de host/path**: um Ingress sem annotations continua bom e suportado.

## Trade-offs

- **Ingress vs Gateway API.** O Ingress é mais simples e universalmente conhecido; a Gateway API é mais verbosa, porém expressiva e portável sem annotations, e é onde as funcionalidades novas chegam.
- **DaemonSet com hostPort vs Service LoadBalancer.** O add-on do MicroK8s ocupa 80/443 direto no nó, perfeito para um nó; com vários nós você precisa de algo na frente (DNS round robin, MetalLB, um load balancer externo).
- **Classes de compatibilidade vs reescrever manifests.** A classe `nginx` no Traefik faz manifests antigos rodarem na hora; depender dela no longo prazo é depender de uma camada de compatibilidade em vez das funcionalidades nativas do controller.

## Documentation Links

- [Kubernetes docs: Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/): regras, tipos de path, TLS, IngressClass.
- [Kubernetes docs: Gateway API](https://kubernetes.io/docs/concepts/services-networking/gateway/): modelo de recursos e papéis.
- [Gateway API: HTTPRoute](https://gateway-api.sigs.k8s.io/reference/api-types/httproute/): matches, filters, referências de backend.
- [Kubernetes blog: Announcing Ingress2Gateway 1.0](https://kubernetes.io/blog/2026/03/20/ingress2gateway-1-0-release): ferramenta de migração de Ingress para Gateway API.
- [MicroK8s: Release notes](https://canonical.com/microk8s/docs/release-notes): o add-on de ingress trocando NGINX por Traefik.
- [Traefik docs: Kubernetes Ingress NGINX provider](https://doc.traefik.io/traefik/reference/install-configuration/providers/kubernetes/kubernetes-ingress-nginx/): annotations do NGINX suportadas.
