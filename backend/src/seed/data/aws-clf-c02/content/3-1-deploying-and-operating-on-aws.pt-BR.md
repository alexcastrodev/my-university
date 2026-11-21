---
version: 1.1
updatedAt: 2026-11-21
---
# Implantação e operação na AWS: console, CLI, SDKs, infraestrutura como código e modelos de implantação

> Domínio do exame: **Tecnologia e Serviços de Nuvem (34%)**, objetivo 3.1 *Definir métodos de implantação e operação na Nuvem AWS*.

---

## O que o exame quer

O objetivo 3.1 pede três coisas: como você **acessa** os serviços da AWS, como você **provisiona e opera** recursos (ações pontuais versus processos repetíveis) e qual **modelo de implantação** uma empresa usa (nuvem, híbrido, no local). As questões quase sempre são "qual método de acesso serve para esta pessoa e esta tarefa".

---

## Cinco formas de entrar, uma decisão

| Método | O que é | Escolha quando |
|--------|---------|----------------|
| **AWS Management Console** | Interface gráfica baseada em navegador | Uma pessoa explora, aprende ou faz uma tarefa pontual clicando |
| **AWS CLI** | Ferramenta de linha de comando de código aberto para bash, zsh, tcsh, prompt de comando do Windows, PowerShell ou um shell em uma instância EC2 | Um administrador automatiza tarefas por script a partir de um terminal; oferece funcionalidade equivalente à do console |
| **AWS SDKs** | Bibliotecas de linguagem (Java, Python, JavaScript, .NET, Go e outras) | O código da aplicação precisa chamar os serviços da AWS sem escrever requisições HTTP à mão |
| **APIs (endpoints de serviço)** | O ponto de entrada em URL de cada serviço, por exemplo `https://dynamodb.us-west-2.amazonaws.com` | Algo precisa chamar o serviço diretamente; a CLI e os SDKs usam o endpoint regional padrão para você |
| **Infraestrutura como código (IaC)** | Recursos descritos em arquivos de template, implantados por um serviço como o AWS CloudFormation | O mesmo ambiente precisa ser criado várias vezes, revisado e versionado como código-fonte |

```text
 one-time, by hand                          repeatable, automated
 ------------------                         ---------------------
 Console  ->  CLI one-liner  ->  CLI script  ->  SDK in an app  ->  CloudFormation template
```

Um pequeno exemplo de CLI: listar os buckets do S3 da conta configurada.

```bash
aws s3 ls
```

A mesma chamada feita a partir do código da aplicação passa pelo SDK da respectiva linguagem. Ninguém "faz login na CLI" com uma senha do console: a CLI e os SDKs usam credenciais programáticas, e o console usa um login.

---

## Operações pontuais versus processos repetíveis

- **Pontual**: investigar um problema, criar um bucket de teste, consultar um painel. O console atende bem.
- **Repetível**: criar ambientes idênticos de teste, homologação e produção, ou reconstruir em outra Região. Use infraestrutura como código, para que o resultado seja o mesmo toda vez e as mudanças possam ser revisadas.
- Clicar pelo console a cada novo ambiente é lento e provoca divergência (drift) entre os ambientes. Essa é a pista para IaC.

---

## AWS CloudFormation

- Você escreve um **template** (um arquivo de texto em JSON ou YAML) que descreve os recursos e suas propriedades.
- O CloudFormation os cria como uma **stack**. O mesmo template provisiona os mesmos recursos repetidamente, e em várias Regiões.
- Os templates são arquivos de texto, então você os controla em um sistema de versionamento como código-fonte.
- A **detecção de drift** encontra mudanças que alguém fez nos recursos da stack fora do CloudFormation, por exemplo no console do EC2.
- Pelo **registro do CloudFormation**, é possível ativar extensões (tipos de recurso, módulos, Hooks) da AWS, de publicadores terceiros e privadas, suas. O CloudFormation não se limita a tipos de recurso da AWS.
- **Modelo de preços**: não há cobrança do CloudFormation para tipos de recurso da AWS (`AWS::*`), você paga pelos recursos criados. Tipos de recurso de terceiros e privados são cobrados por operação de handler (em 21/11/2026).
- O **AWS CDK** permite definir a infraestrutura em TypeScript, JavaScript, Python, Java, C# ou Go, e faz a implantação por meio do CloudFormation.

```yaml
Resources:
  LogsBucket:
    Type: AWS::S3::Bucket
```

> Material de estudo antigo diz que o CloudFormation "não consegue criar recursos que não sejam da AWS" e que é sempre gratuito. A documentação oficial atual diz que tipos de recurso de terceiros são aceitos por meio do registro, e que apenas os tipos de recurso da AWS não têm cobrança do CloudFormation.

---

## AWS Elastic Beanstalk

- Você envia um pacote com o código-fonte da aplicação. O Beanstalk provisiona as instâncias EC2, configura o balanceamento de carga, ativa o monitoramento de integridade e escala o ambiente.
- As plataformas incluem Go, Java (Java SE e Tomcat), .NET, Node.js, PHP, Python, Ruby e Docker.
- **Sem cobrança adicional** pelo Elastic Beanstalk: você paga pelos recursos subjacentes (EC2, S3, balanceamento de carga).

| Você quer... | Use |
|--------------|-----|
| Implantar uma aplicação web e deixar a AWS cuidar da capacidade, do balanceamento de carga e do escalonamento | **Elastic Beanstalk** |
| Descrever qualquer conjunto de recursos da AWS (redes, bancos de dados, filas) como um template | **CloudFormation** |
| Escrever a infraestrutura em uma linguagem de programação | **AWS CDK** (faz a implantação por meio do CloudFormation) |

---

## CI/CD: CodeBuild e CodePipeline

| Serviço | Função |
|---------|--------|
| **AWS CodeBuild** | Serviço de build totalmente gerenciado: compila o código-fonte, executa testes de unidade e produz artefatos implantáveis, sem servidores de build para gerenciar |
| **AWS CodePipeline** | Serviço de entrega contínua que modela e automatiza os estágios de uma release (código-fonte, build, teste, implantação) e pode incluir uma aprovação manual |

Um pipeline clássico: um commit aciona o CodePipeline, o CodeBuild compila e testa, uma pessoa aprova, e então a release vai para produção.

Fora do escopo ou descontinuados (uma linha cada, apenas para evitar confusão): **AWS CodeDeploy**, **AWS CodeArtifact** e **AWS CloudShell** estão explicitamente fora do escopo deste exame; **AWS CodeStar** e **AWS OpsWorks** foram encerrados; o **AWS Cloud9** não está mais disponível para novos clientes.

---

## Operação em escala: AWS Systems Manager

O Systems Manager permite visualizar, gerenciar e operar nós em escala na AWS, no local (on-premises) e em outras nuvens. Suas ferramentas incluem Run Command, Session Manager, Automation e Parameter Store, e uma tarefa típica é aplicar patches de segurança em uma frota de instâncias. (Mais no módulo 4.)

> Material de estudo antigo ensina "Chef ou Puppet significa AWS OpsWorks". O OpsWorks, em todas as suas variantes, chegou ao fim do suporte em 1º de maio de 2024. Não o escolha como um serviço atual.

---

## Modelos de implantação

| Modelo | Significado | Pista do cenário |
|--------|-------------|------------------|
| **Nuvem** | A aplicação inteira roda na nuvem, construída lá ou migrada | "Tudo roda na AWS" |
| **Híbrido** | Recursos na nuvem conectados a recursos existentes fora da nuvem, normalmente no local (on-premises) | "O banco de dados fica no nosso data center, a camada web roda na AWS" |
| **No local (on-premises)** | Recursos implantados localmente com ferramentas de virtualização e de gerenciamento de recursos (muitas vezes chamado de nuvem privada) | "Tudo fica no nosso próprio data center" |

O AWS Outposts (lição 3-2) é uma forma de executar a infraestrutura da AWS no local como parte de um design híbrido.

---

## Atenção

- **Console para trabalho pontual, IaC para trabalho repetível.** "Ambientes idênticos em várias Regiões" significa CloudFormation, não uma pessoa seguindo um roteiro no console.
- **SDK versus CLI.** O código dentro de uma aplicação usa um SDK. Uma pessoa ou um script de shell em um terminal usa a CLI.
- **Beanstalk versus CloudFormation.** O Beanstalk executa sua aplicação para você; o CloudFormation provisiona os recursos que o template descreve. Nenhum dos dois cobra por si mesmo, você paga pelos recursos.
- **Detecção de drift** é a resposta para "alguém alterou os recursos da stack manualmente".
- **O CodeBuild compila e testa; o CodePipeline orquestra a release.** O CodeDeploy está fora do escopo, portanto não é a resposta esperada.
- **Híbrido significa conectado.** Uma empresa com um data center no local e recursos na AWS interligados é híbrida, não "nuvem".

## Verificação rápida

1. A aplicação Python de um desenvolvedor precisa gravar objetos no S3. Qual método de acesso? **Um AWS SDK.**
2. Uma equipe precisa criar a mesma rede, os mesmos servidores e o mesmo banco de dados em três Regiões, revisados como código. Qual serviço? **AWS CloudFormation.**
3. Alguém editou um grupo de segurança criado por uma stack. Qual recurso informa isso? **Detecção de drift do CloudFormation.**
4. Uma empresa envia uma aplicação web em Java e quer que a AWS cuide do balanceamento de carga e do escalonamento. Qual serviço? **AWS Elastic Beanstalk.**
5. Uma empresa mantém seu ERP no local e o conecta a novos serviços na AWS. Qual modelo de implantação? **Híbrido.**

## Documentação oficial

- [What is the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-welcome.html)
- [AWS SDKs and Tools overview](https://docs.aws.amazon.com/sdkref/latest/guide/overview.html)
- [AWS service endpoints](https://docs.aws.amazon.com/general/latest/gr/rande.html)
- [What is AWS CloudFormation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/Welcome.html)
- [CloudFormation drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html)
- [What is AWS Elastic Beanstalk](https://docs.aws.amazon.com/elasticbeanstalk/latest/dg/Welcome.html)
- [What is AWS CodePipeline](https://docs.aws.amazon.com/codepipeline/latest/userguide/welcome.html)
- [Types of cloud computing (deployment models)](https://aws.amazon.com/types-of-cloud-computing/)
