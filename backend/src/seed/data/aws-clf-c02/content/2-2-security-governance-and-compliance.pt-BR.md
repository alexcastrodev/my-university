---
version: 1.0
updatedAt: 2026-11-21
---
# Segurança, governança e conformidade: criptografia, KMS, Artifact, Organizations e logs de auditoria

> Domínio do exame: **Segurança e Conformidade (30%)**, objetivo 2.2 *Entender os conceitos de segurança, governança e conformidade da Nuvem AWS*.

---

## O pilar Segurança em sete princípios

O **pilar Segurança** do Well-Architected apresenta sete princípios de design. O exame associa um controle a um deles.

| Princípio | Como aparece na prática |
|-----------|-------------------------|
| **Implementar uma base sólida de identidade** | Gerenciamento centralizado de identidades e permissões de privilégio mínimo (lição 2.3) |
| **Manter a rastreabilidade** | Registrar e monitorar ações e mudanças (CloudTrail, Config) |
| **Aplicar segurança em todas as camadas** | Defesa em profundidade: proteções da conta, borda da rede, VPC, balanceamento de carga, cada instância e serviço de computação, sistema operacional, aplicação, código |
| **Automatizar as melhores práticas de segurança** | Detecção e correção automáticas em vez de revisões manuais |
| **Proteger os dados em trânsito e em repouso** | Criptografia e controle de acesso para dados armazenados e em movimento |
| **Manter as pessoas longe dos dados** | Reduzir o acesso humano direto aos dados |
| **Preparar-se para eventos de segurança** | Ter a resposta a incidentes pronta antes de precisar dela |

O framework atual agrupa as práticas de segurança em quatro áreas: governança e operações de segurança (incluindo detecção e resposta a incidentes), gerenciamento de identidade e acesso, proteção de dados e proteção de infraestrutura e aplicações.

> Material de estudo antigo diz "enable traceability" e lista sete áreas de segurança do whitepaper independente do Security Pillar; a documentação oficial atual diz "maintain traceability", marca esse whitepaper como histórico e usa quatro áreas.

---

## Criptografia: em repouso vs em trânsito

| Necessidade | Controle usual |
|-------------|----------------|
| Dados **em movimento** entre o cliente e a AWS (navegador até o balanceador de carga, aplicação até o banco de dados) | **SSL/TLS** (HTTPS), com um certificado do AWS Certificate Manager (lição 2.4) |
| Dados **armazenados** (objetos do S3, volumes do EBS, bancos de dados do RDS) | **Criptografia no lado do servidor** com chaves do AWS KMS |
| A AWS **nunca pode ver o texto simples** | **Criptografia no lado do cliente**: você criptografa antes de enviar, e assim os dados ficam protegidos em trânsito e em repouso |
| Link privado a partir do seu data center (**AWS Direct Connect**) | **Não é criptografado por padrão**. Adicione uma VPN Site-to-Site (IPsec) sobre o Direct Connect, ou MACsec em conexões compatíveis |

A AWS criptografa, na camada física, todos os dados que cruzam Regiões na sua rede global antes de saírem das instalações da AWS, além de todo o tráfego entre Zonas de Disponibilidade.

### Amazon S3

- Desde **5 de janeiro de 2023**, todo novo upload de objeto é **criptografado automaticamente com SSE-S3** (AES-256) sem custo adicional. Isso **não pode ser desativado** para novos uploads. Objetos que já existiam sem criptografia antes dessa data não foram criptografados retroativamente.
- Opções no lado do servidor: **SSE-S3** (padrão), **SSE-KMS** (chaves do KMS, auditável), **DSSE-KMS** (duas camadas), **SSE-C** (você fornece a chave a cada requisição). No lado do cliente: você executa o processo e guarda as chaves.

> Material de estudo antigo diz que o S3 armazena uploads sem criptografia, a menos que você a ative; a documentação oficial atual diz que todos os novos uploads são criptografados com SSE-S3 por padrão e que isso não pode ser desativado.

### EBS e RDS

- Um volume do EBS criptografado protege os dados em repouso **e** os dados que trafegam entre a instância e o volume; os snapshots permanecem criptografados. Você pode ativar a **criptografia por padrão** para novos volumes.
- Nem um volume do EBS existente nem uma instância do RDS existente podem ser convertidos para criptografados no mesmo lugar: faça uma **cópia criptografada de um snapshot** e crie um novo volume ou restaure uma nova instância a partir dela.

---

## AWS KMS e AWS CloudHSM

O **AWS KMS** cria e controla as chaves que criptografam e assinam seus dados. As chaves são protegidas por HSMs validados no FIPS 140-3 Security Level 3 e **nunca saem do KMS sem criptografia**. As chaves do KMS pertencem à **Região** em que você as cria (chaves multi-Região são um caso especial). O uso de chaves gerenciadas pelo cliente e chaves gerenciadas pela AWS é **registrado no AWS CloudTrail**.

| Tipo de chave do KMS | Onde fica | Seu controle | Visível no CloudTrail |
|----------------------|-----------|--------------|-----------------------|
| **Chave gerenciada pelo cliente** | Na sua conta | Você a cria, escreve a política da chave e escolhe a rotação | Sim |
| **Chave gerenciada pela AWS** (alias `aws/service`) | Na sua conta | Apenas visualizar e auditar; a AWS a rotaciona todo ano | Sim |
| **Chave pertencente à AWS** | Em uma conta de serviço da AWS | Nenhum, você não a vê | Não |

As chaves gerenciadas pela AWS são um tipo legado: desde 2021, os novos serviços usam chaves pertencentes à AWS por padrão.

> Material de estudo antigo diz "customer master key (CMK)"; a documentação oficial atual diz "AWS KMS key" (ou "KMS key"). O conceito não mudou.

O **AWS CloudHSM** fornece HSMs **de locatário único**. A AWS provisiona, faz backup e mantém o hardware; **você** controla as chaves, os algoritmos e os usuários do HSM (gerenciados fora do IAM). Isso significa mais controle e mais responsabilidade.

| Requisito | Escolha |
|-----------|---------|
| Chaves gerenciadas integradas com S3, EBS e RDS, auditadas no CloudTrail | **AWS KMS** |
| Hardware dedicado, de locatário único; você mesmo gerencia os usuários do HSM | **AWS CloudHSM** |

"FIPS Level 3" sozinho não separa mais os dois, porque os HSMs do KMS também são validados nesse nível. A palavra que decide é **locatário único** (single-tenant).

---

## Conformidade: AWS Artifact

O **AWS Artifact** é o portal gratuito e de autoatendimento com informações de conformidade da AWS:

- **Relatórios:** baixe sob demanda os documentos de segurança e conformidade da própria AWS, como relatórios SOC, certificações ISO e relatórios PCI. Você aceita o NDA do AWS Artifact antes de baixar.
- **Acordos:** revise, aceite, acompanhe e encerre acordos como o **HIPAA Business Associate Addendum (BAA)**, para uma conta ou para toda a organização. Os acordos da organização exigem o AWS Organizations com todos os recursos e são aceitos pela **conta de gerenciamento**.

Os programas de conformidade variam por **setor e geografia**: SOC, ISO 27001 e PCI DSS são globais; FedRAMP é das Américas, C5 da EMEA, IRAP da Ásia-Pacífico; HIPAA e GDPR são leis e regulamentações. Nem todo serviço da AWS está no escopo de todo programa, então confira a lista de serviços no escopo para os serviços que você usa.

---

## Governança: AWS Organizations, SCPs e AWS Control Tower

O **AWS Organizations** gerencia várias contas de forma centralizada. Ele tem dois conjuntos de recursos: **todos os recursos** (o padrão e o recomendado) e apenas **faturamento consolidado**. As contas são agrupadas em unidades organizacionais (OUs), com até cinco níveis de profundidade.

A **conta de gerenciamento** cria a organização, cria, convida e remove contas, anexa políticas, habilita integrações de serviços e paga todas as cobranças. A AWS recomenda manter workloads fora dela e usá-la somente para tarefas que a exijam.

As **políticas de controle de serviço (SCPs)** definem as **permissões máximas** das contas-membro:

- Uma SCP **não concede nada**. Uma ação só é permitida se a SCP a permitir **e** uma política do IAM a permitir, e não houver negação explícita.
- As SCPs afetam todas as identidades nas contas-membro, **incluindo o usuário-raiz da conta-membro**.
- As SCPs **não afetam a conta de gerenciamento** e nunca afetam perfis vinculados a serviços (service-linked roles).
- As SCPs exigem o conjunto de todos os recursos.

O **AWS Control Tower** configura e governa um ambiente com várias contas (uma **landing zone**) orquestrando o Organizations, o Service Catalog e o IAM Identity Center. Seus **controles** (também chamados de guardrails) são preventivos, detectivos ou proativos, e o **Account Factory** cria novas contas padronizadas.

---

## Onde ficam os logs de segurança

| Pergunta | Serviço |
|----------|---------|
| **Quem** fez o quê, quando e de onde (chamadas de API pelo console, CLI e SDK) | **AWS CloudTrail** |
| **Como era este recurso** antes, e ele segue as minhas regras | **AWS Config** |
| Métricas e alarmes em recursos e aplicações | **Amazon CloudWatch** (monitoramento) |
| Quem tem quais credenciais, quais permissões não são usadas | **Relatórios de acesso** do IAM (lição 2.3) |

**Detalhes do CloudTrail:** o **Histórico de eventos** é um registro pesquisável e imutável dos últimos **90 dias de eventos de gerenciamento** em cada Região, disponível automaticamente sem cobrança do CloudTrail. Uma **trilha** entrega eventos ao S3 (opcionalmente ao CloudWatch Logs e ao EventBridge) para retenção mais longa; o **CloudTrail Lake** permite armazenar e consultar eventos. As trilhas **não registram eventos de dados por padrão** (nível de objeto do S3, Invoke do Lambda, nível de item do DynamoDB), e os eventos de dados têm custo extra. A **validação de integridade dos arquivos de log** detecta se um arquivo de log entregue foi modificado ou excluído; ela detecta, não bloqueia.

**Detalhes do Config:** registra configurações, relacionamentos e histórico; avalia-os com **regras do Config** e pacotes de conformidade; sinaliza recursos fora de conformidade, pode notificar por meio do SNS e pode **corrigir** recursos fora de conformidade.

---

## Uso aceitável e testes de penetração

- A **Política de Uso Aceitável** proíbe usar a AWS para violar a segurança, a integridade ou a disponibilidade de qualquer usuário ou rede.
- Você pode executar avaliações de segurança **sem aprovação prévia** em uma lista de serviços que inclui EC2, RDS, Aurora, CloudFront, API Gateway, Lambda, Lightsail, Elastic Beanstalk, ECS, Fargate, Elastic Load Balancing e AWS WAF.
- **Proibido:** ataques ou simulações de DoS e DDoS (que seguem uma política separada de simulação de DDoS), flooding e DNS zone walking contra zonas hospedadas do Route 53. Atividades de red team e de comando e controle (C2) exigem **envio prévio**.
- Abusos originados **de** recursos da AWS são reportados à **AWS Trust and Safety**.

---

## Atenção

- **O Direct Connect é privado, não criptografado.** Regra: adicione VPN (IPsec) ou MACsec quando o enunciado disser "criptografado".
- **O S3 já é criptografado em repouso por padrão.** Regra: "a AWS nunca pode ler os dados" é o único caso que força a criptografia no lado do cliente.
- **O Artifact guarda os relatórios da AWS**, ele não deixa você em conformidade. Regra: "baixar o relatório SOC ou PCI da AWS" ou "aceitar o BAA" significa Artifact.
- **As SCPs nunca concedem** e ignoram a conta de gerenciamento. Regra: permissão efetiva = permissão da SCP E permissão do IAM E nenhuma negação explícita.
- **CloudTrail vs Config.** Regra: "quem" é CloudTrail, "o que mudou na configuração" é Config.
- **A validação de integridade detecta adulteração**, não a impede.
- **Fazer teste de penetração no seu próprio EC2 ou RDS não exige aprovação**, mas testes de DoS são proibidos fora da política de simulação de DDoS.

---

## Verificação rápida

1. Uma aplicação precisa manter os dados privados até mesmo da AWS. **Criptografia no lado do cliente com chaves que a empresa guarda.**
2. Um órgão regulador exige hardware de chaves de locatário único. **AWS CloudHSM.**
3. Onde você baixa o relatório PCI DSS da AWS? **AWS Artifact.**
4. Uma SCP nega um serviço na raiz da organização. Os usuários da conta de gerenciamento ainda podem usá-lo? **Sim, as SCPs não afetam a conta de gerenciamento.**
5. Quem parou uma instância há 20 dias, sem nenhuma trilha configurada? **O Histórico de eventos do CloudTrail (90 dias de eventos de gerenciamento).**

---

## Documentação oficial

- [Security pillar design principles](https://docs.aws.amazon.com/wellarchitected/latest/framework/sec-design-principles.html)
- [Protecting data with encryption in Amazon S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingEncryption.html)
- [S3 default encryption FAQ](https://docs.aws.amazon.com/AmazonS3/latest/userguide/default-encryption-faq.html)
- [AWS KMS concepts](https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html)
- [What is AWS Artifact](https://docs.aws.amazon.com/artifact/latest/ug/what-is-aws-artifact.html)
- [Service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html)
- [What is AWS CloudTrail](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html)
- [Penetration testing policy](https://aws.amazon.com/security/penetration-testing/)
