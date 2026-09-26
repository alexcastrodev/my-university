---
version: 1.0
updatedAt: 2026-09-26
title: "Deploy a partir de um Pipeline de CI"
summary: "Uma identidade de menor privilégio para o CI, um kubeconfig de contexto único, render, diff, apply e rollout status, e deploys push vs pull (GitOps)."
---
## Objective

Implantar à mão a partir de um laptop não escala e não deixa rastro. Um pipeline de CI que roda `kubectl apply -k` é o próximo passo natural, e ele levanta três perguntas: qual identidade o pipeline usa (nunca o kubeconfig de admin), como ele escolhe o cluster e o namespace certos (contexto explícito, não o que estiver como atual), e como ele sabe que o deploy funcionou de verdade (`rollout status`, não o exit code do `apply`). Este conceito monta um job de deploy baseado em push de ponta a ponta, e o compara com a alternativa GitOps baseada em pull.

## Use Cases

- Implantar todo merge na `main` em staging, e releases com tag em produção.
- Dar ao pipeline exatamente as permissões de que ele precisa nos namespaces em que implanta.
- Fazer o pipeline falhar quando a versão nova não fica pronta.
- Implantar num cluster que não é acessível pela internet.

## Deep Dive

### Uma identidade para o pipeline

Crie uma ServiceAccount por namespace de destino e vincule só o que implantar exige (veja o conceito de RBAC para uma Role sob medida; a ClusterRole embutida `edit` é um começo razoável):

```bash
kubectl -n team-a create serviceaccount ci-deployer
kubectl -n team-a create rolebinding ci-deployer --clusterrole=edit \
  --serviceaccount=team-a:ci-deployer
```

Dê ao pipeline um **token de vida curta**, não uma Secret de vida longa:

```bash
kubectl -n team-a create token ci-deployer --duration=1h
```

Duas opções práticas:

- **Federação OIDC** (a melhor): o sistema de CI emite um token OIDC por job (GitHub Actions e GitLab CI fazem isso), e o API server é configurado para confiar nesse emissor (`--authentication-config` / autenticação estruturada). Nenhuma credencial de cluster armazenada. Exige controle sobre as flags do API server, que você tem no MicroK8s (`args/kube-apiserver`).
- **Um token ou kubeconfig armazenado** no cofre de segredos do CI, restrito ao namespace e rotacionado. Se precisar guardar um de vida longa, ele deve pertencer a uma ServiceAccount que só consegue implantar num namespace.

Nunca guarde no CI o kubeconfig de admin do `microk8s config`: o certificado de cliente dele está em `system:masters`, ignora o RBAC e não pode ser revogado sem rotacionar a CA do cluster.

### Um kubeconfig montado no job

```bash
kubectl config set-cluster target --server="$K8S_SERVER" \
  --certificate-authority=<(printf '%s' "$K8S_CA_PEM") --embed-certs=true
kubectl config set-credentials ci --token="$K8S_TOKEN"
kubectl config set-context deploy --cluster=target --user=ci --namespace=team-a
kubectl config use-context deploy
```

O kubeconfig do job contém exatamente um contexto, então nenhum comando consegue acertar outro cluster por acidente. Mesmo assim passe `--context deploy -n team-a` explicitamente nos scripts; isso documenta a intenção e sobrevive a alguém adicionar um segundo contexto depois.

### O job de deploy

Um exemplo com GitHub Actions (os mesmos passos funcionam em qualquer CI):

```yaml
deploy-staging:
  runs-on: ubuntu-latest
  environment: staging                    # segredos e aprovações por environment
  steps:
    - uses: actions/checkout@v4
    - name: Set image tag
      run: |
        cd k8s/overlays/staging
        kustomize edit set image registry.example.com/demo/web-app=registry.example.com/demo/web-app:${GITHUB_SHA}
    - name: Render and diff
      run: |
        kubectl kustomize k8s/overlays/staging > rendered.yaml
        kubectl diff -f rendered.yaml || [ $? -eq 1 ]      # 1 = diferenças, >1 = erro
    - name: Apply
      run: kubectl apply -f rendered.yaml
    - name: Wait for rollout
      run: |
        for d in $(kubectl get deploy -o name); do
          kubectl rollout status "$d" --timeout=300s
        done
    - name: Smoke test
      run: curl -fsS --retry 10 --retry-delay 3 https://staging.example.com/healthz
```

Os detalhes que o tornam confiável:

- **Tags imutáveis**: a tag da imagem é o SHA do commit, então todo deploy muda o template do Pod e um rollout de fato acontece.
- **Renderize uma vez, aplique o que foi renderizado**: o artefato `rendered.yaml` pode ser guardado com o job, então você sempre sabe exatamente o que foi implantado.
- **Exit codes do `kubectl diff`**: `0` sem mudanças, `1` mudanças, qualquer outro valor erro (por exemplo `field is immutable` num Job). Trate `1` como sucesso e maiores como falha.
- **`rollout status` é o resultado real**: o `apply` tem sucesso assim que a API aceita os objetos. O job precisa falhar se os Pods entrarem em crash loop ou nunca ficarem prontos.
- **Proteção de environment**: deploys de produção atrás de uma aprovação manual, com credenciais de produção visíveis só para aquele environment.

Numa falha, o job pode rodar `kubectl rollout undo` em cada Deployment, mas aí Git e cluster discordam. Prefira falhar de forma visível e corrigir para frente, ou reverter o commit para que a próxima execução do pipeline reimplante o estado anterior.

### Clusters que o CI não alcança

Um cluster de nó único atrás de um firewall não tem endpoint de API público, e não deveria ganhar um só por causa do CI. Opções:

- Um **runner self-hosted** dentro da rede, que alcança o API server localmente.
- Um passo de VPN ou túnel no job (WireGuard, Tailscale) para chegar ao nó.
- **GitOps baseado em pull**: um agente dentro do cluster (Argo CD, Flux) observa o repositório Git e aplica as mudanças ele mesmo. O CI só constrói imagens e atualiza a tag no Git. O cluster precisa de acesso de saída ao Git e ao registry, e de nenhum acesso de entrada.

### Push vs pull

| | Push (CI roda kubectl) | Pull (agente GitOps) |
|---|---|---|
| Credenciais | o CI guarda credenciais do cluster | o cluster guarda credenciais de leitura do Git |
| Rede | o CI precisa alcançar o API server | o cluster precisa alcançar o Git |
| Desvios | só corrigidos no próximo deploy | detectados e corrigidos continuamente |
| Visibilidade | nos logs do CI | na interface do GitOps e no histórico do Git |
| Configuração | mínima | um controller para instalar e rodar |

## Trade-offs

- **Push vs pull.** Push é mais simples de começar e mantém tudo na ferramenta de CI; pull tira as credenciais do cluster do CI e corrige desvios continuamente, ao custo de rodar mais um componente.
- **Tokens armazenados vs federação OIDC.** Tokens armazenados funcionam em qualquer lugar e precisam ser rotacionados; OIDC elimina segredos armazenados e exige configuração no API server.
- **Identidade de deploy por namespace vs no cluster todo.** Identidades restritas limitam o estrago de um segredo de CI vazado; identidades no cluster todo são mais simples para pipelines que gerenciam muitos namespaces e perigosas pelo mesmo motivo.

## Documentation Links

- [Kubernetes docs: Authenticating (OpenID Connect tokens)](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#openid-connect-tokens): confiando num emissor externo.
- [Kubernetes docs: Service account tokens (kubectl create token)](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_create/kubectl_create_token/): tokens de vida curta.
- [kubectl diff reference](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_diff/): exit codes.
- [Argo CD documentation](https://argo-cd.readthedocs.io/en/stable/): GitOps baseado em pull.
- [GitHub Docs: Using environments for deployment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment): aprovações e segredos por environment.
