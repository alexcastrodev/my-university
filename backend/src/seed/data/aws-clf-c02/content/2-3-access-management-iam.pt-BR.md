---
version: 1.0
updatedAt: 2026-11-21
---
# Gerenciamento de acesso: IAM, usuário-raiz, MFA, perfis (roles), Identity Center e Cognito

> Domínio do exame: **Segurança e Conformidade (30%)**, objetivo 2.3 *Identificar os recursos de gerenciamento de acesso da AWS*.

---

## IAM em quatro fatos

O **AWS Identity and Access Management (IAM)** decide quem é **autenticado** (fez login) e **autorizado** (tem permissões) para usar os recursos da AWS.

- **Sem cobrança adicional** pelo IAM, pelo IAM Identity Center ou pelo AWS STS. Você paga apenas pelos recursos que suas identidades usam.
- **Global:** o IAM é um serviço baseado em Região que está disponível globalmente. As identidades que você cria são replicadas para todas as Regiões habilitadas, então uma nova Região não exige nenhum trabalho no IAM.
- **Negação por padrão:** uma requisição só é permitida quando uma política a permite.
- **Privilégio mínimo:** conceda apenas as ações, nos recursos específicos, sob as condições que uma tarefa precisa. Comece com as políticas gerenciadas pela AWS, refine em suas próprias políticas gerenciadas pelo cliente e remova o acesso que as informações de "último acesso" mostram não estar sendo usado.

---

## Os blocos de construção

| Identidade | O que é | Credenciais |
|------------|---------|-------------|
| **Usuário-raiz** | A identidade criada com a conta, com acesso completo | E-mail e senha (proteja com MFA) |
| **Usuário do IAM** | Uma pessoa ou workload com credenciais de longo prazo em uma conta | Senha (console) e/ou até **duas** chaves de acesso (CLI, SDK, API) |
| **Grupo do IAM** | Um conjunto de usuários que compartilham políticas anexadas | **Nenhuma.** Um grupo não pode fazer login e não pode ser um principal em uma política |
| **Perfil (role) do IAM** | Um conjunto de permissões que **qualquer pessoa autorizada pode assumir** | **Sem credenciais de longo prazo.** Assumi-lo retorna credenciais **temporárias** do AWS STS |

Regras dos grupos: um usuário pode pertencer a vários grupos; os grupos **não podem ser aninhados**; não existe grupo padrão.

Quem pode assumir um perfil (definido na **política de confiança** do perfil): usuários do IAM da mesma conta ou de **outra conta**, outros perfis, **serviços da AWS** como EC2 e Lambda, e usuários **federados** por meio de um provedor de identidade SAML 2.0 ou OIDC. Os perfis são a principal forma de conceder acesso **entre contas** e a forma de dar a uma instância EC2 ou função Lambda acesso à AWS **sem guardar chaves** no código.

---

## Políticas e como elas se combinam

| Tipo de política | Quem escreve | Observações |
|------------------|--------------|-------------|
| **Gerenciada pela AWS** | AWS | Reutilizável, **você não pode editá-la** (por exemplo `AdministratorAccess`) |
| **Gerenciada pelo cliente** | Você | Reutilizável, editável, a ferramenta para o privilégio mínimo |
| **Em linha (inline)** | Você | Embutida em uma única identidade, excluída junto com ela |

Uma política de identidade de privilégio mínimo que permite a um analista ler um bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:ListBucket"],
    "Resource": ["arn:aws:s3:::finance-reports", "arn:aws:s3:::finance-reports/*"]
  }]
}
```

Avaliação em uma conta:

1. Tudo começa **negado**.
2. As permissões **de identidade e de recurso** (por exemplo uma política de bucket) **se somam**.
3. Uma **negação explícita em qualquer política prevalece** sobre todas as permissões.
4. Proteções como **SCPs** e limites de permissões não concedem nada; a ação também precisa ser permitida por elas.

---

## O usuário-raiz

Tarefas exclusivas do usuário-raiz (a lista oficial atual):

- Alterar o e-mail, a senha ou as chaves de acesso do usuário-raiz, e **encerrar** uma conta independente (ou reabrir uma conta encerrada)
- **Restaurar as permissões do IAM** quando o único administrador se bloqueou
- **Ativar o acesso do IAM** ao console de Faturamento e Gerenciamento de Custos; algumas tarefas de faturamento e certas notas fiscais de impostos
- Cadastrar-se no AWS GovCloud (US); registrar-se como vendedor no **Reserved Instance Marketplace**
- Recuperar uma chave do KMS não gerenciável por meio do AWS Support
- Habilitar o **S3 MFA Delete**
- Editar ou excluir uma política de bucket do S3 ou uma política de fila do SQS que **nega todos os principais**

Não são exclusivas do usuário-raiz: o **nome da conta**, as informações de contato, os contatos alternativos, a moeda de pagamento, as Regiões e a **alteração do plano do AWS Support** (as permissões do IAM no console de Planos de Suporte bastam).

Proteja-o: senha forte, **MFA** (agora obrigatório para os usuários-raiz de todos os tipos de conta), **sem chaves de acesso do usuário-raiz**, um endereço de e-mail de grupo, uso monitorado e identidades do IAM ou do Identity Center para o trabalho diário. No AWS Organizations, as credenciais do usuário-raiz das contas-membro podem ser removidas de forma centralizada, e as SCPs restringem os usuários-raiz das contas-membro.

> Material de estudo antigo diz que alterar o nome da conta ou o plano de Suporte exige o usuário-raiz; a documentação oficial atual diz que ambos podem ser feitos com permissões do IAM.

---

## Credenciais, MFA e política de senhas

| Ponto de entrada | Credencial |
|------------------|------------|
| AWS Management Console | Nome de usuário e senha, mais MFA |
| AWS CLI, SDKs, API | **ID da chave de acesso + chave de acesso secreta** (o segredo é exibido apenas uma vez, na criação) |
| SSH para uma instância EC2 | Chaves SSH; a AWS recomenda o EC2 Instance Connect para gerenciá-las |
| HTTPS no seu site | Um **certificado de servidor** SSL/TLS (ACM). Ele **não** é uma credencial de login |

**Tipos de MFA:** passkeys e chaves de segurança (FIDO, resistentes a phishing, recomendadas), aplicativos autenticadores virtuais e tokens TOTP de hardware. Até **8** dispositivos MFA por usuário-raiz ou usuário do IAM. Uma chave de acesso de longo prazo não carrega MFA por si só; o acesso à API protegido por MFA funciona por meio de **credenciais temporárias** do STS com um código MFA e uma condição de política.

> Material de estudo antigo lista mensagens de texto SMS como opção de MFA; a documentação oficial atual diz que o MFA por SMS não pode mais ser habilitado.

**Política de senhas.** Sem uma política personalizada, as senhas dos usuários do IAM exigem de 8 a 128 caracteres e pelo menos três de quatro tipos de caracteres (maiúsculas, minúsculas, números, símbolos), e **nunca expiram**. Uma política personalizada pode definir um comprimento mínimo, os tipos de caracteres exigidos, a expiração (de 1 a 1.095 dias), a prevenção de reutilização e se os usuários alteram a própria senha. Não existe configuração de bloqueio de conta, e a política não se aplica nem ao usuário-raiz nem às chaves de acesso.

---

## Força de trabalho, clientes e diretórios

| Quem faz login | Use |
|----------------|-----|
| Funcionários, uma única vez, em **várias contas da AWS** e aplicativos gerenciados pela AWS | **AWS IAM Identity Center** (diretório próprio ou um IdP externo por SAML 2.0) |
| Clientes do seu **aplicativo web ou móvel** (cadastro, login com Google ou Apple, convidados) | **Amazon Cognito**: os pools de usuários fazem o login e emitem tokens; os pools de identidades trocam tokens por credenciais temporárias da AWS |
| Workloads do Microsoft Active Directory | **AWS Directory Service** (lição 2.4) |

A AWS recomenda a **federação** com um provedor de identidade e credenciais temporárias para usuários humanos, e o IAM Identity Center para acesso centralizado entre contas.

> Material de estudo antigo diz "AWS Single Sign-On (AWS SSO)"; a documentação oficial atual diz que ele foi renomeado para **AWS IAM Identity Center** em 26 de julho de 2022. O IAM em si não é um serviço de logon único.

---

## Armazenando credenciais para aplicações

| Necessidade | Use |
|-------------|-----|
| Senhas de banco de dados, chaves de API, tokens OAuth com **rotação automática** | **AWS Secrets Manager** (cobrado por segredo e por chamada de API) |
| Valores de configuração, opcionalmente criptografados (SecureString com KMS), sem rotação | **AWS Systems Manager Parameter Store** (nível padrão gratuito) |
| Acesso à AWS para código executado na AWS | Um **perfil (role) do IAM**, não uma chave armazenada |

---

## Relatórios de acesso e acesso ao S3

- **Relatório de credenciais:** um CSV com todos os usuários do IAM e o status de suas senhas, chaves de acesso, MFA e certificados.
- **IAM Access Analyzer:** encontra recursos compartilhados com entidades **externas** (buckets do S3, perfis, chaves do KMS, funções Lambda, segredos do Secrets Manager e mais), acessos não usados, e valida políticas.
- **Informações de último acesso:** mostram usuários, perfis, permissões e credenciais não usados, para que você possa reduzi-los.
- **S3:** novos buckets e objetos **não são públicos por padrão**; o **Block Public Access** prevalece sobre políticas e ACLs; as ACLs são **desabilitadas por padrão** (Object Ownership "Bucket owner enforced"), então o acesso é gerenciado com políticas do IAM e políticas de bucket.

---

## Atenção

- **Grupos não têm credenciais.** Regra: os grupos organizam permissões, usuários e perfis se autenticam.
- **Workload na AWS que precisa de acesso à AWS: perfil (role).** Regra: nunca embuta chaves de acesso no código nem em uma instância.
- **A negação explícita prevalece.** Regra: uma única negação em qualquer lugar vence qualquer número de permissões.
- **Lista exclusiva do usuário-raiz.** Regra: alterações do nome da conta e do plano de Suporte não estão mais nela; encerrar uma conta independente e o MFA Delete estão.
- **Identity Center vs Cognito.** Regra: seus funcionários nas contas da AWS é Identity Center; os clientes do seu aplicativo é Cognito.
- **Secrets Manager vs Parameter Store.** Regra: "rotacionar automaticamente" significa Secrets Manager.

---

## Verificação rápida

1. Uma aplicação em EC2 precisa ler o S3. **Anexe um perfil (role) do IAM à instância.**
2. Uma conta parceira precisa de acesso de leitura a um bucket por uma semana. **Um perfil (role) do IAM entre contas com uma política de confiança para essa conta.**
3. É possível alterar o nome da conta sem o usuário-raiz? **Sim, com permissões do IAM.**
4. Onde um jogo móvel obtém credenciais temporárias da AWS para convidados? **Nos pools de identidades do Amazon Cognito.**
5. Qual ferramenta mostra que uma chave do KMS é compartilhada com uma conta externa? **IAM Access Analyzer.**

---

## Documentação oficial

- [What is IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html)
- [Tasks that require root user credentials](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-tasks.html)
- [IAM security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)
- [IAM roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles.html)
- [MFA in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa.html)
- [What is IAM Identity Center](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)
- [What is Amazon Cognito](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html)
- [What is AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
