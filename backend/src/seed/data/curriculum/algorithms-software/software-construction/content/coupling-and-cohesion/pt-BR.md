---
version: 1.0
updatedAt: 2026-09-06
title: Acoplamento e Coesão
summary: Acoplamento mede quanto um módulo depende dos internos de outro (quer-se baixo); coesão mede quão bem as próprias responsabilidades de um módulo pertencem juntas (quer-se alto); ambos são ocultação de informação vista de fora e de dentro respectivamente.
---
## Objetivos de Aprendizagem

- Definir acoplamento e coesão precisamente, e enunciar qual direção ("quer-se baixo" vs. "quer-se alto") se aplica a cada um.
- Identificar uma "classe Deus" ou módulo emaranhado como um design de baixa coesão, e explicar o que especificamente faz suas responsabilidades não pertencerem juntas.
- Identificar dois módulos que alcançam os internos um do outro como um design de acoplamento alto/apertado, e explicar o que quebra por causa disso.
- Refatorar um módulo de baixa coesão em peças focadas, de responsabilidade única, e refatorar módulos fortemente acoplados para interagir só através de uma interface limpa.
- Explicar por que acoplamento e coesão são, em efeito, ocultação de informação vista de dois pontos de vista diferentes.

## Contexto e Motivação

Ocultação de informação estabeleceu que um módulo deveria ser organizado em torno de uma decisão que vale a pena esconder, com uma interface que permanece estável enquanto a decisão escondida por baixo é livre para mudar. Acoplamento e coesão são o que acontece quando esse princípio é transformado em algo mensurável, dois medidores, ambos sobre fronteiras de módulo, mas apontados em direções opostas. **Acoplamento** mede quanto um módulo depende dos detalhes internos de outro; o objetivo é mantê-lo *baixo*, para que uma mudança dentro de um módulo não se propague para outros. **Coesão** mede quão apertadamente as próprias responsabilidades de um único módulo pertencem juntas; o objetivo é mantê-la *alta*, para que um módulo possa ser descrito, entendido, e mudado como uma única coisa coerente em vez de como um pacote acidental de preocupações não relacionadas.

Essas duas ideias não são objetivos de design independentes que aconteceram de ser ensinados lado a lado, são a mesma pergunta subjacente feita a partir de duas direções. Ocultação de informação pergunta: essa fronteira de módulo é traçada de forma que uma decisão escondida possa mudar sem consequência externa? Coesão faz essa pergunta olhando *para dentro*: tudo dentro da fronteira deste único módulo de fato pertence à mesma decisão escondida, ou decisões não relacionadas foram empacotadas juntas por acidente? Acoplamento a faz olhando *para fora*: algo fora da fronteira deste módulo depende de fatos que deveriam ter permanecido escondidos dentro dela? Um módulo com baixa coesão é realmente vários módulos diferentes usando uma única etiqueta de nome; um par de módulos com acoplamento alto são realmente os internos de um módulo espalhados através de uma fronteira que foi traçada no lugar errado.

Esse par está diretamente na área de conhecimento de Engenharia de Software do ACM/IEEE e no material de construção de software 6.005/6.031 do MIT por uma razão concreta, prática: é a ferramenta diagnóstica mais confiável única para olhar para uma base de código desconhecida e imediatamente identificar de onde a dor vai vir. Uma classe com quarenta métodos não relacionados (baixa coesão) é uma classe que vai precisar mudar por quarenta razões não relacionadas, e cada uma dessas mudanças arrisca quebrar as outras trinta e nove peças de comportamento não relacionado empacotadas dentro dela. Duas classes que leem os campos privados uma da outra diretamente (acoplamento alto) não podem ser testadas, implantadas, ou mesmo entendidas isoladamente uma da outra, você nunca pode olhar para só uma. Aprender a ver esses dois formatos de falha, e os refactors que consertam cada um, é o ganho prático de tudo que esta disciplina construiu até agora, e prepara diretamente os próximos dois conceitos: padrões de design são em grande parte receitas nomeadas para alcançar acoplamento baixo e coesão alta em situações específicas recorrentes, e SOLID é um conjunto de cinco técnicas concretas visando exatamente os mesmos dois medidores, especializadas para design orientado a objetos.

## Teoria Central

### Coesão: as próprias responsabilidades de um módulo pertencem juntas?

Coesão é uma propriedade *interna*, pergunta se as coisas que um módulo faz estão relacionadas entre si por um único propósito coerente, versus ser um saco de gatos arbitrário que acontece de viver na mesma classe ou arquivo. Um módulo **altamente coeso** tem uma razão clara para mudar: se sua única responsabilidade precisa ser diferente, aquele módulo muda; se alguma preocupação não relacionada precisa ser diferente, aquele módulo não é tocado. Um módulo de **baixa coesão**, frequentemente apelidado de "classe Deus" ou "objeto Deus" quando o problema é severo, tem muitas razões não relacionadas para mudar, todas empacotadas em um lugar, então um pedido para mudar como faturas são formatadas e um pedido para mudar como uma conexão de banco de dados é aberta ambos pousam, confusamente, na mesma classe de 2.000 linhas.

O teste prático para coesão é o Princípio da Responsabilidade Única de Robert C. Martin em miniatura (formalizado por completo no conceito de SOLID que segue este): você consegue descrever o que este módulo faz em uma frase, sem usar a palavra "e" para juntar duas preocupações não relacionadas? "Esta classe valida e persiste e envia email e registra cadastros de usuário" é quatro responsabilidades vestindo um nome, e é exatamente o formato que um problema de coesão assume na prática.

### Acoplamento: quanto um módulo depende dos internos de outro?

Acoplamento é uma propriedade *externa*, pergunta quanto um módulo sabe sobre, ou depende dos, detalhes internos específicos de outro módulo, em vez de só de seu contrato público. **Acoplamento baixo (frouxo)** significa que módulos interagem só através de interfaces estáveis, estreitas, exatamente o que ocultação de informação é destinada a produzir, para que as mudanças internas de um módulo nunca forcem mudanças em outro. **Acoplamento alto (apertado)** significa que módulos alcançam além das interfaces um do outro: lendo os campos privados um do outro, assumindo um layout de dados interno específico, ou dependendo de peculiaridades de ordem de chamada que nunca fizeram parte de nenhum contrato documentado.

Acoplamento apertado é caro de uma forma bem específica: torna a *unidade de mudança* maior que qualquer módulo isoladamente. Uma correção de bug ou pedido de funcionalidade que deveria ter tocado um arquivo agora exige tocar dois (ou mais), em sincronia, porque os dois nunca foram de fato independentes, só pareciam dessa forma na árvore de arquivos.

```mermaid
graph LR
    subgraph "Fortemente acoplado (antes)"
        A1["OrderProcessor"] -->|lê order._items diretamente| B1["Order<br/>(lista interna exposta)"]
        A1 -->|escreve order._total diretamente| B1
    end
    subgraph "Fracamente acoplado (depois)"
        A2["OrderProcessor"] -->|chama order.total()| B2["Order<br/>(internos escondidos)"]
        A2 -->|chama order.add_item(x)| B2
    end
```

À esquerda, `OrderProcessor` depende exatamente de como `Order` armazena seus itens e total; qualquer mudança interna em `Order` arrisca quebrar `OrderProcessor`. À direita, `OrderProcessor` depende só das operações públicas de `Order`; os internos de `Order` podem mudar livremente.

### A relação entre os dois, e por que ambos importam juntos

Alta coesão e baixo acoplamento tendem a se reforçar mutuamente, e isso não é coincidência. Um módulo construído em torno de uma única responsabilidade clara naturalmente tem uma interface pública pequena, focada (porque só há uma coisa coerente para expor), o que torna fácil para outros módulos dependerem daquela interface frouxamente. Reciprocamente, uma "classe Deus" de baixa coesão tende a acumular acoplamento apertado como efeito colateral: porque faz muitas coisas não relacionadas, muitos outros módulos não relacionados acabam dependendo de muitas *partes* não relacionadas dela, e desemaranhar qualquer uma dependência significa entender a classe espalhada inteira primeiro.

É possível, embora menos comum, ter alta coesão com design de interface ruim (um módulo que faz uma coisa mas expõe seus internos descuidadamente), ou baixa coesão com interfaces tecnicamente estreitas (uma classe Deus que acontece de expor poucos métodos, cada um dos quais faz cinco coisas não relacionadas internamente). Os dois são cheiros de design correlacionados, não logicamente idênticos, que é exatamente por que engenharia de software os trata como dois medidores separados, nomeados, em vez de colapsá-los em um.

### Medindo informalmente: as perguntas a fazer

Não há uma única pontuação automatizada que capture completamente qualquer propriedade, mas ambas admitem testes informais confiáveis. Para coesão: liste tudo que um módulo faz, e pergunte se remover qualquer um item também removeria a razão pela qual os outros estão agrupados juntos, se não, não pertencem juntos. Para acoplamento: pergunte, para dois módulos A e B, se A poderia ser substituído por uma implementação diferente sem que o código de B mudasse de forma alguma, se o código de B precisasse mudar, A e B estão acoplados exatamente no ponto que precisaria mudar.

## Exemplos Resolvidos

### Exemplo 1 — Uma classe Deus refatorada em peças coesas

**Problema:** Uma classe `UserRegistration` valida entrada, persiste um novo usuário em um banco de dados, envia um email de boas-vindas, e registra o evento, quatro responsabilidades não relacionadas em uma classe.

```python
# --- Antes: baixa coesão, uma classe, quatro trabalhos não relacionados ---
class UserRegistration:
    def register(self, email, password):
        # responsabilidade 1: validação
        if "@" not in email or len(password) < 8:
            raise ValueError("invalid input")
        # responsabilidade 2: persistência
        db_connection = open_db_connection()
        db_connection.execute("INSERT INTO users VALUES (?, ?)", (email, password))
        # responsabilidade 3: notificação
        send_email(email, subject="Welcome!", body="Thanks for joining.")
        # responsabilidade 4: registro de log
        write_log(f"registered new user {email}")


# --- Depois: quatro colaboradores coesos, de responsabilidade única ---
class RegistrationValidator:
    def validate(self, email, password):
        if "@" not in email or len(password) < 8:
            raise ValueError("invalid input")

class UserRepository:
    def save(self, email, password):
        db_connection = open_db_connection()
        db_connection.execute("INSERT INTO users VALUES (?, ?)", (email, password))

class WelcomeNotifier:
    def notify(self, email):
        send_email(email, subject="Welcome!", body="Thanks for joining.")

class RegistrationLogger:
    def log_registration(self, email):
        write_log(f"registered new user {email}")

class UserRegistration:
    def __init__(self, validator, repository, notifier, logger):
        self._validator = validator
        self._repository = repository
        self._notifier = notifier
        self._logger = logger

    def register(self, email, password):
        self._validator.validate(email, password)
        self._repository.save(email, password)
        self._notifier.notify(email)
        self._logger.log_registration(email)
```

**Raciocínio.** Cada uma das quatro classes "depois" tem exatamente uma razão para mudar: uma nova regra de senha muda só `RegistrationValidator`; trocar bancos de dados muda só `UserRepository`; mudar o provedor de email muda só `WelcomeNotifier`. A versão "antes" empacotou todas as quatro razões-para-mudar em uma classe, então qualquer uma dessas quatro mudanças não relacionadas arriscava tocar (e quebrar) as outras três preocupações vivendo no mesmo método. O `UserRegistration` refatorado agora é um coordenador fino com alta coesão própria, sua única responsabilidade é orquestrar a *sequência* de cadastro, não realizar nenhum dos quatro trabalhos ele mesmo.

### Exemplo 2 — Módulos fortemente acoplados refatorados para uma interface limpa

**Problema:** `OrderProcessor` calcula um desconto lendo a lista interna de itens de `Order` diretamente e mutando seu campo total interno diretamente.

```python
# --- Antes: acoplamento apertado, alcança os internos de Order ---
class Order:
    def __init__(self):
        self._items = []      # destinado a ser interno
        self._total = 0       # destinado a ser interno

class OrderProcessor:
    def apply_discount(self, order, percent):
        order._total = sum(item.price for item in order._items)   # lê internos
        order._total *= (1 - percent / 100)                        # escreve internos


# --- Depois: acoplamento frouxo, interage só através da interface de Order ---
class Order:
    def __init__(self):
        self._items = []
        self._total = 0

    def add_item(self, item):
        self._items.append(item)
        self._total += item.price

    def total(self):
        return self._total

    def apply_discount(self, percent):
        self._total *= (1 - percent / 100)

class OrderProcessor:
    def apply_discount(self, order, percent):
        order.apply_discount(percent)   # delega; nenhum interno tocado
```

**Raciocínio.** Na versão "antes", `OrderProcessor` assume que `Order` armazena itens em uma lista chamada `_items` e um total corrente em `_total`, se `Order` mais tarde é mudado para calcular totais preguiçosamente, ou para armazenar itens em um dicionário chaveado por SKU, `OrderProcessor` quebra mesmo que nada sobre "aplicar um desconto" conceitualmente mudasse. Na versão "depois", a lógica de desconto se move *para dentro* de `Order`, que é onde o conhecimento da representação de `_total` já vive; `OrderProcessor` chama um método e não sabe nada sobre como `Order` armazena qualquer coisa. Esse é o refactor de acoplamento-e-coesão trabalhando juntos: `Order` ganhou um pouco de coesão (a lógica de desconto pertence com o total que modifica) precisamente removendo um problema de acoplamento (uma classe externa manipulando seus internos).

### Exemplo 3 — Testando a pergunta "B precisaria mudar"

**Problema:** Dois designs para calcular custo de frete: (A) `ShippingCalculator` lê `order.items` e manualmente soma pesos inline; (B) `ShippingCalculator` chama `order.total_weight()`.

```python
# Design A
class ShippingCalculator:
    def cost(self, order):
        weight = sum(i.weight for i in order.items)   # assume que order.items existe e é iterável
        return weight * 0.5

# Design B
class ShippingCalculator:
    def cost(self, order):
        return order.total_weight() * 0.5              # pede a Order o fato de que precisa
```

**Raciocínio.** Aplique o teste de acoplamento da Teoria Central: se o armazenamento interno de `Order` muda (digamos, itens se tornam um dicionário chaveado por ID de produto em vez de uma lista), o `ShippingCalculator` do Design A deve mudar também, porque assumiu diretamente um iterável chamado `items`. O `ShippingCalculator` do Design B não precisa de nenhuma mudança de forma alguma, `Order` é livre para recalcular `total_weight()` como quiser internamente. Design A está acoplado a um detalhe de representação que nunca de fato precisou; Design B depende só do único fato (`total_weight`) que verdadeiramente exige, que é a essência de manter acoplamento baixo: dependa do menor, mais estável fato que você de fato precisa, nunca de como aquele fato acontece de ser armazenado hoje.

## Equívocos Comuns e Armadilhas

- **"Menos classes sempre significa design melhor."** Espremer quatro responsabilidades em uma classe para "reduzir o número de arquivos" é precisamente como uma classe Deus se forma, coesão é sobre se responsabilidades pertencem juntas conceitualmente, não sobre minimizar uma contagem de arquivo. A versão "depois" do Exemplo 1 tem mais classes e é o design melhor.
- **"Acoplamento é ruim, ponto final, então módulos nunca deveriam depender um do outro."** Algum acoplamento é inevitável e até desejável, todo módulo depende de *algo*. O objetivo é acoplamento baixo através de uma interface estável, não acoplamento zero; `OrderProcessor` no Exemplo 2 ainda depende de `Order`, só de seu contrato público em vez de seus campos privados.
- **"Se duas classes estão fisicamente no mesmo arquivo ou pacote, devem estar fortemente acopladas."** Acoplamento é sobre dependência em detalhes internos, não sobre proximidade física ou organização, duas classes no mesmo arquivo podem interagir puramente através de métodos públicos (fracamente acopladas), enquanto duas classes em pacotes inteiramente separados podem alcançar o estado privado uma da outra através de uma chamada de rede (fortemente acopladas apesar de "distantes").
- **"Um método getter automaticamente conserta acoplamento."** Um getter que retorna uma referência interna mutável (como coberto no conceito de ocultação de informação) ainda vaza a representação e ainda cria acoplamento apertado, o chamador pode mutar o que recebeu de volta, e agora depende do tipo interno daquele objeto retornado tanto quanto se tivesse alcançado diretamente. Só um getter que retorna um valor, uma cópia, ou uma visão genuinamente somente leitura de fato reduz acoplamento.

## Resumo

Acoplamento mede quanto um módulo depende dos detalhes internos de outro (quer-se baixo); coesão mede quão apertadamente as próprias responsabilidades de um único módulo pertencem juntas (quer-se alto). Ambos são o princípio de ocultação de informação aplicado no nível de fronteira de módulo, coesão pergunta se tudo dentro de uma fronteira genuinamente pertence a uma decisão escondida, acoplamento pergunta se algo fora de uma fronteira depende de fatos que deveriam ter permanecido escondidos dentro dela. Uma "classe Deus" empacotando responsabilidades não relacionadas é a falha clássica de baixa coesão, consertada dividindo-a em colaboradores focados, de responsabilidade única, como no exemplo `UserRegistration`. Dois módulos lendo e escrevendo os campos privados um do outro é a falha clássica de acoplamento apertado, consertada movendo lógica para onde quer que os dados relevantes já vivam e interagindo só através de uma interface pública estreita, como no exemplo `Order`/`OrderProcessor`. Esses dois medidores são a base direta para padrões de design (receitas nomeadas para acertar ambos os medidores bem em situações recorrentes) e para SOLID (cinco técnicas concretas visando exatamente essas duas propriedades em designs orientados a objetos).

## Documentation Links

- [ACM/IEEE CS2013 — Software Engineering Knowledge Area](https://csed.acm.org/knowledge-areas-software-engineering-se-cs2013-version/) — doc
- [MIT 6.031/6.005 — Course Home (OCW)](https://ocw.mit.edu/courses/6-005-software-construction-spring-2016/) — doc
